/**
 * Invarianti del router `pricing`.
 *
 * Le procedure di scrittura sono **admin-only per progetto**: `pricing:update`
 * non è nel ruolo editor (`packages/core/src/auth/permissions.ts`), ed è una
 * regola esplicita in CLAUDE.md. Un editor che riesce a modificare un set di
 * parametri cambia i prezzi di listino di una stagione intera, quindi la matrice
 * dei permessi qui è la parte più importante del file.
 *
 * Le funzioni di calcolo pure sono coperte in
 * `src/services/__tests__/pricing.service.test.ts`: quei test non passano dal
 * router e non muovono il gate di copertura procedure. Qui si esercita il
 * percorso di produzione, `appRouter` incluso.
 */

import { randomUUID } from 'crypto';

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

import { rateLimitStore } from '../src/lib/ratelimit';
import { appRouter } from '../src/routers/index';

import { setupTestDb } from './helpers/database';
import { createSilentLogger } from './helpers/logger';

import type { UserSession } from '../src/lib/auth';
import type { Context } from '../src/lib/trpc';
import type { PrismaClient } from '@prisma/client';

let prisma: PrismaClient;
const sessions: Record<'admin' | 'editor' | 'viewer', UserSession> = {} as never;

function createContext(session: UserSession): Context {
  return {
    prisma,
    session,
    logger: createSilentLogger(),
    req: { headers: {}, ip: '127.0.0.1', log: createSilentLogger() } as any,
    res: {} as any,
    traceId: randomUUID(),
  };
}

function callerAs(role: 'admin' | 'editor' | 'viewer') {
  return appRouter.createCaller(createContext(sessions[role])).pricing;
}

/** Input valido minimo, con i valori realistici del seed. */
function validInput(name: string) {
  return {
    name,
    countryCode: 'CN',
    purchaseCurrency: 'CNY',
    sellingCurrency: 'EUR',
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
  return { brandId: brand.id, seasonId: season.id };
}

beforeAll(async () => {
  // `setupTestDb()` garantisce lo schema e tronca: l'ordine dei file non è
  // stabile, nessuna suite può assumere che un'altra abbia creato le tabelle.
  prisma = await setupTestDb();

  for (const role of ['admin', 'editor', 'viewer'] as const) {
    const uid = randomUUID().substring(0, 8);
    const user = await prisma.user.create({
      data: {
        email: `pricing-${role}-${uid}@test.com`,
        username: `pricing-${role}-${uid}`,
        firstName: 'Pricing',
        lastName: role,
        role,
        isActive: true,
      },
    });
    sessions[role] = {
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        role,
        tokenVersion: 0,
      },
    };
  }
});

beforeEach(() => {
  // `create` e `update` sono rate-limited: senza azzerare lo store i test si
  // bloccherebbero a vicenda dopo poche mutation.
  rateLimitStore.clear();
});

describe('pricing — matrice dei permessi', () => {
  it('editor e viewer non possono scrivere set di parametri', async () => {
    const { brandId, seasonId } = await createBrandAndSeason();

    // `pricing:update` non è nel ruolo editor: è una decisione di prodotto, non
    // una svista. Se un giorno la matrice cambia, questo test deve fallire.
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
    const anon = appRouter.createCaller({
      ...createContext(sessions.admin),
      session: null,
    }).pricing;

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

    // CLAUDE.md: i calcoli sono sempre scoped a brandId + seasonId. Conoscere
    // l'id di un set non basta a usarlo in un contesto che non è il suo.
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

    // Senza questo, una stagione nuova non avrebbe alcun set selezionato e la
    // calcolatrice partirebbe vuota.
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

    // Restare senza default lascerebbe la stagione senza set selezionato: il
    // buco si vedrebbe solo aprendo la pagina prezzi.
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

    // L'unicità è per (brand, stagione, nome): "Standard" deve poter esistere
    // ovunque, altrimenti il nome diventa una risorsa globale scarsa.
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

    // Il controllo di unicità deve escludere sé stesso, altrimenti nessun set
    // sarebbe più modificabile dopo la creazione.
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

    // Il nome dice "copy", il contratto dice sola lettura. Se un giorno
    // qualcuno la fa persistere, la stagione nuova si ritrova set che nessuno
    // ha confermato — e senza questa asserzione nulla lo segnalerebbe.
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

    // Al 100% il moltiplicatore aziendale diverge: il limite è nello schema Zod.
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

    // `mode: 'inverse'` senza `retailPrice` è respinto dal refine dello schema,
    // non dal corpo della procedura.
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
  it('xlsx produce un file per il brand+stagione richiesti', async () => {
    const { brandId, seasonId } = await createBrandAndSeason();
    const admin = callerAs('admin');

    await admin.parameterSets.create({
      brandId,
      seasonId,
      data: validInput('Standard'),
    });

    const result = await admin.export.xlsx({ brandId, seasonId });

    expect(result.filename).toMatch(/\.xlsx$/i);
    // base64 non vuoto: un export che ritorna una stringa vuota è un file
    // corrotto che si scopre solo aprendolo.
    expect(result.data.length).toBeGreaterThan(0);
  });

  /**
   * REGRESSIONE APERTA — `export.pdf` è rotto su questa linea di release.
   *
   * Il commit `a864236` ("chore(deps): phase 1 — safe bumps") ha portato pdfmake
   * da **0.2.23 a 0.3.11**. Da 0.2 a 0.3 è un cambio breaking, e il call site in
   * `lib/export/pdf.ts` non è stato migrato. Due rotture, non una:
   *
   * 1. Il costruttore è `(fontDescriptors, virtualfs, urlResolver,
   *    localAccessPolicy)`, e `resolveUrls()` dereferenzia `this.urlResolver`
   *    per ogni font. `new PdfPrinter(getPdfFonts())` lo lascia `undefined`:
   *      TypeError: Cannot read properties of undefined (reading 'resolve')
   *        at PdfPrinter.resolveUrls (pdfmake/js/Printer.js:126)
   * 2. `createPdfKitDocument` è diventata **async**. `pdf.ts:256` la tratta come
   *    stream sincrono (`doc.on('data', …)`), che su una Promise non esiste.
   *
   * Riprodotto in Node puro, fuori da vitest: non è un limite dell'ambiente di
   * test. L'errore esce come **unhandled rejection** e la promise di
   * `createPdfBuffer` non si risolve mai — per questo il caso è `todo` e non
   * `fails`: eseguirlo inquinerebbe l'intero file con un errore non gestito.
   *
   * Portata: **tutti e quattro** gli export PDF dell'app — `pricing`,
   * `collectionLayout`, `collectionLayoutRevision`, `rowPdf` — condividono
   * `createPdfBuffer`.
   *
   * Non è un difetto storico: `v1.9.1` e precedenti hanno pdfmake 0.2.23 e
   * funzionano. La regressione vive solo in `v1.10.0-rc.1`…`rc.11`, quindi
   * partirebbe con `v1.10.0`.
   *
   * Quando sarà corretto: rimuovere `.todo` e asserire filename `.pdf` + base64
   * non vuoto, come per xlsx.
   */
  it.todo('pdf produce un file — regressione pdfmake 0.3, vedi commento');
});
