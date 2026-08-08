/**
 * Invariants of the `pricing` router.
 *
 * The write procedures are **admin-only by design**: `pricing:update`
 * is not in the editor role (`packages/core/src/auth/permissions.ts`), and this is an
 * explicit rule in CLAUDE.md. An editor who manages to modify a parameter set
 * changes the list prices of an entire season, so the permission
 * matrix here is the most important part of the file.
 *
 * The pure calculation functions are covered in
 * `src/services/__tests__/pricing.service.test.ts`: those tests do not go through the
 * router and do not move the procedure coverage gate. Here the production
 * path is exercised, `appRouter` included.
 */

import { randomUUID } from 'crypto';

import { describe, it, expect, beforeAll } from 'vitest';

import {
  createAnonymousCaller,
  createCallerWithSession,
  createTestUser,
  setupTestDb,
} from './helpers';

import type { UserSession } from '../src/lib/auth';
import type { PrismaClient } from '@prisma/client';

let prisma: PrismaClient;
const sessions: Record<'admin' | 'editor' | 'viewer', UserSession> = {} as never;

/** Team that editor and viewer are members of; the brand scopes are attached to it. */
let scopeTeamId: string;


function callerAs(role: 'admin' | 'editor' | 'viewer') {
  return createCallerWithSession(sessions[role]).pricing;
}

/** Minimal valid input, with realistic seed values. */
function validInput(name: string) {
  return {
    name,
    countryCode: 'CN',
    // `as const`: the schema accepts the union of PRICING_CURRENCIES,
    // not just any string.
    purchaseCurrency: 'CNY' as const,
    sellingCurrency: 'EUR' as const,
    qualityControlPercent: 2,
    transportInsuranceCost: 3,
    duty: 8,
    exchangeRate: 1.08,
    italyAccessoryCosts: 2,
    tools: 1,
    retailMultiplier: 2.6,
    optimalMargin: 62,
  };
}

async function createBrandAndSeason(year = 2030) {
  const uid = randomUUID().substring(0, 6).toUpperCase();
  const brand = await prisma.brand.create({
    data: { code: `PR${uid}`, name: `Pricing ${uid}`, isActive: true },
  });
  const season = await prisma.season.create({
    data: { code: `P${uid}`, name: `Season ${uid}`, year, isActive: true },
  });
  await grantBrandScope(brand.id);
  return { brandId: brand.id, seasonId: season.id };
}

/**
 * Grants editor and viewer access to the brand just created.
 *
 * Brand access is **strict opt-in**: `getUserAllowedBrandIds` returns `null`
 * (no restriction) only for admins, and for everyone else exactly the union
 * of the `brandScopes` of active teams. An editor with no team sees no brand.
 * Before the brand scope guards, these tests passed because no pricing
 * procedure checked the scope -- i.e. for the very defect the guards close.
 * Coverage of the negative case lives in `brandScope.integration.spec.ts`.
 */
async function grantBrandScope(brandId: string) {
  await prisma.companyTeamBrandScope.create({
    data: { teamId: scopeTeamId, brandId },
  });
}

beforeAll(async () => {
  // `setupTestDb()` guarantees the schema and truncates: file order is not
  // stable, no suite can assume that another one has already created the tables.
  prisma = await setupTestDb();

  const roles = ['admin', 'editor', 'viewer'] as const;
  const created = await Promise.all(roles.map(role => createTestUser(role)));
  roles.forEach((role, i) => {
    sessions[role] = created[i].session;
  });

  const uid = randomUUID().substring(0, 6);
  const fn = await prisma.companyFunction.create({
    data: { slug: `pricing_fn_${uid}`, name: `Pricing Fn ${uid}`, order: 93, isActive: true },
  });
  const team = await prisma.companyTeam.create({
    data: { functionId: fn.id, name: `Pricing Team ${uid}`, isActive: true },
  });
  scopeTeamId = team.id;

  await Promise.all(
    created
      .filter((_, i) => roles[i] !== 'admin')
      .map(u =>
        prisma.companyTeamMembership.create({
          data: { teamId: team.id, userId: u.user.id },
        })
      )
  );
});

describe('pricing — matrice dei permessi', () => {
  it('editor e viewer non possono scrivere set di parametri', async () => {
    const { brandId, seasonId } = await createBrandAndSeason();

    // `pricing:update` is not in the editor role: this is a product decision, not
    // an oversight. If the matrix ever changes, this test must fail.
    for (const role of ['editor', 'viewer'] as const) {
      const caller = callerAs(role);

      await expect(
        caller.parameterSets.create({
          brandId,
          seasonId,
          data: validInput('Tentativo'),
        })
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });

      await expect(
        caller.parameterSets.remove({ id: randomUUID(), brandId, seasonId })
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });

      await expect(
        caller.parameterSets.setDefault({ id: randomUUID(), brandId, seasonId })
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
  });

  it('editor e viewer possono leggere e calcolare', async () => {
    const { brandId, seasonId } = await createBrandAndSeason();
    const set = await callerAs('admin').parameterSets.create({
      brandId,
      seasonId,
      data: validInput('Standard'),
    });

    for (const role of ['editor', 'viewer'] as const) {
      const caller = callerAs(role);

      await expect(
        caller.parameterSets.list({ brandId, seasonId })
      ).resolves.toHaveLength(1);

      await expect(
        caller.calculate({
          mode: 'forward',
          purchasePrice: 100,
          parameterSetId: set.id,
          brandId,
          seasonId,
        })
      ).resolves.toMatchObject({ mode: 'forward' });

      await expect(
        caller.parameterSets.copyFromPreviousSeason({ brandId, seasonId })
      ).resolves.not.toThrow();
    }
  });

  it('un anonimo non raggiunge nulla', async () => {
    const { brandId, seasonId } = await createBrandAndSeason();
    const anon = (await createAnonymousCaller()).pricing;

    await expect(
      anon.parameterSets.list({ brandId, seasonId })
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});

describe('pricing — scoping brand+stagione', () => {
  it('calculate rifiuta un set che appartiene a un altro brand', async () => {
    const a = await createBrandAndSeason();
    const b = await createBrandAndSeason();
    const admin = callerAs('admin');

    const setOfA = await admin.parameterSets.create({
      brandId: a.brandId,
      seasonId: a.seasonId,
      data: validInput('Set di A'),
    });

    // CLAUDE.md: calculations are always scoped to brandId + seasonId. Knowing
    // a set's id is not enough to use it in a context that is not its own.
    await expect(
      admin.calculate({
        mode: 'forward',
        purchasePrice: 100,
        parameterSetId: setOfA.id,
        brandId: b.brandId,
        seasonId: b.seasonId,
      })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('calculate segnala un set inesistente come NOT_FOUND', async () => {
    const { brandId, seasonId } = await createBrandAndSeason();

    await expect(
      callerAs('admin').calculate({
        mode: 'forward',
        purchasePrice: 100,
        parameterSetId: randomUUID(),
        brandId,
        seasonId,
      })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('update rifiuta un set che non appartiene al brand+stagione indicati', async () => {
    const a = await createBrandAndSeason();
    const b = await createBrandAndSeason();
    const admin = callerAs('admin');

    const setOfA = await admin.parameterSets.create({
      brandId: a.brandId,
      seasonId: a.seasonId,
      data: validInput('Set di A'),
    });

    await expect(
      admin.parameterSets.update({
        brandId: b.brandId,
        seasonId: b.seasonId,
        data: { ...validInput('Rinominato'), id: setOfA.id },
      })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('list restituisce solo i set del proprio brand+stagione', async () => {
    const a = await createBrandAndSeason();
    const b = await createBrandAndSeason();
    const admin = callerAs('admin');

    await admin.parameterSets.create({
      brandId: a.brandId,
      seasonId: a.seasonId,
      data: validInput('Solo di A'),
    });

    await expect(
      admin.parameterSets.list({ brandId: b.brandId, seasonId: b.seasonId })
    ).resolves.toEqual([]);
  });
});

describe('pricing — invariante del set di default', () => {
  it('il primo set creato diventa default', async () => {
    const { brandId, seasonId } = await createBrandAndSeason();

    const first = await callerAs('admin').parameterSets.create({
      brandId,
      seasonId,
      data: validInput('Primo'),
    });

    // Without this, a new season would have no set selected and the
    // calculator would start empty.
    expect(first.isDefault).toBe(true);
  });

  it('esiste sempre esattamente un default per brand+stagione', async () => {
    const { brandId, seasonId } = await createBrandAndSeason();
    const admin = callerAs('admin');

    const first = await admin.parameterSets.create({
      brandId,
      seasonId,
      data: validInput('Primo'),
    });
    const second = await admin.parameterSets.create({
      brandId,
      seasonId,
      data: validInput('Secondo'),
    });

    expect(second.isDefault).toBe(false);

    await admin.parameterSets.setDefault({ id: second.id, brandId, seasonId });

    const sets = await admin.parameterSets.list({ brandId, seasonId });
    expect(sets.filter(s => s.isDefault).map(s => s.id)).toEqual([second.id]);
    expect(sets.find(s => s.id === first.id)?.isDefault).toBe(false);
  });

  it('eliminare il default ne promuove un altro', async () => {
    const { brandId, seasonId } = await createBrandAndSeason();
    const admin = callerAs('admin');

    const first = await admin.parameterSets.create({
      brandId,
      seasonId,
      data: validInput('Primo'),
    });
    await admin.parameterSets.create({
      brandId,
      seasonId,
      data: validInput('Secondo'),
    });

    await admin.parameterSets.remove({ id: first.id, brandId, seasonId });

    // Being left without a default would leave the season with no set selected: the
    // gap would only be noticed by opening the pricing page.
    const sets = await admin.parameterSets.list({ brandId, seasonId });
    expect(sets).toHaveLength(1);
    expect(sets[0].isDefault).toBe(true);
  });

  it('eliminare l’ultimo set lascia la stagione vuota senza errori', async () => {
    const { brandId, seasonId } = await createBrandAndSeason();
    const admin = callerAs('admin');

    const only = await admin.parameterSets.create({
      brandId,
      seasonId,
      data: validInput('Unico'),
    });
    await admin.parameterSets.remove({ id: only.id, brandId, seasonId });

    await expect(
      admin.parameterSets.list({ brandId, seasonId })
    ).resolves.toEqual([]);
  });
});

describe('pricing — unicità del nome', () => {
  it('due set con lo stesso nome nello stesso brand+stagione sono in conflitto', async () => {
    const { brandId, seasonId } = await createBrandAndSeason();
    const admin = callerAs('admin');

    await admin.parameterSets.create({
      brandId,
      seasonId,
      data: validInput('Duplicato'),
    });

    await expect(
      admin.parameterSets.create({
        brandId,
        seasonId,
        data: validInput('Duplicato'),
      })
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('lo stesso nome è ammesso in stagioni diverse', async () => {
    const a = await createBrandAndSeason();
    const b = await createBrandAndSeason();
    const admin = callerAs('admin');

    await admin.parameterSets.create({
      brandId: a.brandId,
      seasonId: a.seasonId,
      data: validInput('Standard'),
    });

    // Uniqueness is per (brand, season, name): "Standard" must be able to exist
    // everywhere, otherwise the name becomes a scarce global resource.
    await expect(
      admin.parameterSets.create({
        brandId: b.brandId,
        seasonId: b.seasonId,
        data: validInput('Standard'),
      })
    ).resolves.toMatchObject({ name: 'Standard' });
  });

  it('rinominare un set su un nome già preso è un conflitto', async () => {
    const { brandId, seasonId } = await createBrandAndSeason();
    const admin = callerAs('admin');

    await admin.parameterSets.create({
      brandId,
      seasonId,
      data: validInput('Occupato'),
    });
    const second = await admin.parameterSets.create({
      brandId,
      seasonId,
      data: validInput('Libero'),
    });

    await expect(
      admin.parameterSets.update({
        brandId,
        seasonId,
        data: { ...validInput('Occupato'), id: second.id },
      })
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('salvare un set col proprio nome invariato non è un conflitto', async () => {
    const { brandId, seasonId } = await createBrandAndSeason();
    const admin = callerAs('admin');

    const set = await admin.parameterSets.create({
      brandId,
      seasonId,
      data: validInput('Stabile'),
    });

    // The uniqueness check must exclude itself, otherwise no set
    // would be editable anymore after creation.
    await expect(
      admin.parameterSets.update({
        brandId,
        seasonId,
        data: { ...validInput('Stabile'), duty: 12, id: set.id },
      })
    ).resolves.toMatchObject({ name: 'Stabile', duty: 12 });
  });
});

describe('pricing — brand e stagione devono esistere', () => {
  it('create su un brand inesistente è NOT_FOUND', async () => {
    const { seasonId } = await createBrandAndSeason();

    await expect(
      callerAs('admin').parameterSets.create({
        brandId: randomUUID(),
        seasonId,
        data: validInput('Orfano'),
      })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('create su una stagione inesistente è NOT_FOUND', async () => {
    const { brandId } = await createBrandAndSeason();

    await expect(
      callerAs('admin').parameterSets.create({
        brandId,
        seasonId: randomUUID(),
        data: validInput('Orfano'),
      })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('pricing — copyFromPreviousSeason', () => {
  it('non salva nulla: è una lettura, malgrado il nome', async () => {
    const uid = randomUUID().substring(0, 6).toUpperCase();
    const brand = await prisma.brand.create({
      data: { code: `CP${uid}`, name: `Copy ${uid}`, isActive: true },
    });
    const past = await prisma.season.create({
      data: { code: `O${uid}`, name: 'Vecchia', year: 2020, isActive: true },
    });
    const current = await prisma.season.create({
      data: { code: `N${uid}`, name: 'Nuova', year: 2031, isActive: true },
    });
    const admin = callerAs('admin');

    await admin.parameterSets.create({
      brandId: brand.id,
      seasonId: past.id,
      data: validInput('Da copiare'),
    });

    const result = await admin.parameterSets.copyFromPreviousSeason({
      brandId: brand.id,
      seasonId: current.id,
    });

    expect(result?.sets).toHaveLength(1);
    expect(result?.sets[0].name).toBe('Da copiare');

    // The name says "copy", the contract says read-only. If one day
    // someone makes it persist, the new season ends up with sets that nobody
    // has confirmed -- and without this assertion nothing would flag it.
    await expect(
      admin.parameterSets.list({ brandId: brand.id, seasonId: current.id })
    ).resolves.toEqual([]);
  });

  it('restituisce null quando non c’è una stagione precedente con parametri', async () => {
    const { brandId, seasonId } = await createBrandAndSeason();

    await expect(
      callerAs('admin').parameterSets.copyFromPreviousSeason({
        brandId,
        seasonId,
      })
    ).resolves.toBeNull();
  });
});

describe('pricing — validazione input', () => {
  it('rifiuta un margine ottimale del 100%', async () => {
    const { brandId, seasonId } = await createBrandAndSeason();

    // At 100% the company multiplier diverges: the limit is enforced in the Zod schema.
    await expect(
      callerAs('admin').parameterSets.create({
        brandId,
        seasonId,
        data: { ...validInput('Impossibile'), optimalMargin: 100 },
      })
    ).rejects.toThrow();
  });

  it('rifiuta un tasso di cambio non positivo', async () => {
    const { brandId, seasonId } = await createBrandAndSeason();

    await expect(
      callerAs('admin').parameterSets.create({
        brandId,
        seasonId,
        data: { ...validInput('Cambio zero'), exchangeRate: 0 },
      })
    ).rejects.toThrow();
  });

  it('rifiuta un codice paese non ISO alpha-2', async () => {
    const { brandId, seasonId } = await createBrandAndSeason();

    await expect(
      callerAs('admin').parameterSets.create({
        brandId,
        seasonId,
        data: { ...validInput('Paese'), countryCode: 'ITA' },
      })
    ).rejects.toThrow();
  });

  it('calculate rifiuta una modalità senza i prezzi che le servono', async () => {
    const { brandId, seasonId } = await createBrandAndSeason();
    const set = await callerAs('admin').parameterSets.create({
      brandId,
      seasonId,
      data: validInput('Standard'),
    });

    // `mode: 'inverse'` without `retailPrice` is rejected by the schema's refine,
    // not by the procedure body.
    await expect(
      callerAs('admin').calculate({
        mode: 'inverse',
        purchasePrice: 100,
        parameterSetId: set.id,
        brandId,
        seasonId,
      })
    ).rejects.toThrow();
  });
});

describe('pricing — export', () => {
  it('xlsx e pdf producono un file per il brand+stagione richiesti', async () => {
    const { brandId, seasonId } = await createBrandAndSeason();
    const admin = callerAs('admin');

    await admin.parameterSets.create({
      brandId,
      seasonId,
      data: validInput('Standard'),
    });

    for (const format of ['xlsx', 'pdf'] as const) {
      const result = await admin.export[format]({ brandId, seasonId });

      expect(result.filename).toMatch(new RegExp(`\\.${format}$`, 'i'));
      // Non-empty base64: an export that returns an empty string is a
      // corrupted file that is only discovered when opened.
      expect(result.data.length).toBeGreaterThan(0);
    }
  });

  it('il pdf è un vero PDF, non una stringa qualunque', async () => {
    const { brandId, seasonId } = await createBrandAndSeason();
    const admin = callerAs('admin');

    await admin.parameterSets.create({
      brandId,
      seasonId,
      data: validInput('Standard'),
    });

    const { data } = await admin.export.pdf({ brandId, seasonId });
    const header = Buffer.from(data, 'base64').subarray(0, 5).toString();

    // Asserting only "non-empty base64" would not have caught the
    // pdfmake 0.2->0.3 regression: you need to look inside the file. `%PDF-` is the signature.
    expect(header).toBe('%PDF-');
  });

});
