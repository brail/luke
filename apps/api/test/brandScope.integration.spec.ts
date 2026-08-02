/**
 * Brand scope: il permesso non è l'accesso.
 *
 * `requirePermission('pricing:read')` risponde a "questo ruolo può leggere i
 * prezzi?". Non risponde a "questo utente può leggere i prezzi **di questo
 * brand**?". Le due domande erano confuse in cinque router: un editor con il
 * permesso, ma il cui team ha scope sul solo brand A, esportava la griglia
 * prezzi del brand B passandone l'UUID — recuperabile dal nome di un PDF
 * condiviso o da una riga di audit log.
 *
 * L'accesso è **opt-in stretto**: `null` (nessun vincolo) è riservato agli
 * admin; per tutti gli altri è esattamente l'unione dei `brandScopes` dei team
 * attivi di cui l'utente è membro.
 */

import { randomUUID } from 'crypto';

import { describe, it, expect, beforeAll } from 'vitest';

import { COLLECTION_STATUS } from '@luke/core';

import {
  createCallerWithSession,
  createTestUser,
  expectUnauthorized,
  setupTestDb,
} from './helpers';

import type { UserSession } from '../src/lib/auth';
import type { PrismaClient } from '@prisma/client';

let prisma: PrismaClient;

/** Editor membro di un team con scope sul solo `inScopeBrandId`. */
let scopedSession: UserSession;
/** Admin: `getUserAllowedBrandIds` restituisce `null`, nessun vincolo. */
let adminSession: UserSession;

let inScopeBrandId: string;
let outOfScopeBrandId: string;
let seasonId: string;

/**
 * Risorse del brand **fuori scope**: sono i bersagli della tabella FORBIDDEN.
 *
 * Costruite passando dal router come admin invece che con Prisma diretto: le
 * righe richiedono un planning group, che richiede un calendario, e `createRow`
 * sa già risolvere quello di default. Meno fixture e, soprattutto, il percorso
 * reale.
 */
const outRes = {
  layoutId: '',
  groupId: '',
  rowId: '',
  quotationId: '',
  revisionId: '',
};

/** Le stesse risorse sul brand in scope, per i casi positivi. */
const inRes = { layoutId: '', rowId: '' };

beforeAll(async () => {
  prisma = await setupTestDb();

  const uid = randomUUID().substring(0, 6).toUpperCase();

  const [editor, admin, inScope, outOfScope, season] = await Promise.all([
    createTestUser('editor'),
    createTestUser('admin'),
    prisma.brand.create({
      data: { code: `IN${uid}`, name: `In scope ${uid}`, isActive: true },
    }),
    prisma.brand.create({
      data: { code: `OUT${uid}`, name: `Out of scope ${uid}`, isActive: true },
    }),
    prisma.season.create({
      data: { code: `S${uid}`, name: `Season ${uid}`, year: 2031, isActive: true },
    }),
  ]);

  scopedSession = editor.session;
  adminSession = admin.session;
  inScopeBrandId = inScope.id;
  outOfScopeBrandId = outOfScope.id;
  seasonId = season.id;

  const fn = await prisma.companyFunction.create({
    data: { slug: `scope_fn_${uid.toLowerCase()}`, name: `Scope Fn ${uid}`, order: 94, isActive: true },
  });
  const team = await prisma.companyTeam.create({
    data: { functionId: fn.id, name: `Scope Team ${uid}`, isActive: true },
  });

  await Promise.all([
    prisma.companyTeamMembership.create({
      data: { teamId: team.id, userId: editor.user.id },
    }),
    // Scope sul solo brand "in": è ciò che rende l'altro fuori portata.
    prisma.companyTeamBrandScope.create({
      data: { teamId: team.id, brandId: inScopeBrandId },
    }),
  ]);

  const asAdmin = createCallerWithSession(adminSession);

  const buildLayout = async (brandId: string) => {
    const layout = await asAdmin.collectionLayout.getOrCreate({
      brandId,
      seasonId,
      availableGenders: ['UOMO'],
    });
    const group = await asAdmin.collectionLayout.groups.create({
      collectionLayoutId: layout.id,
      data: { name: 'Gruppo', order: 0 },
    });
    const row = await asAdmin.collectionLayout.rows.create({
      groupId: group.id,
      gender: 'UOMO',
      line: 'Linea',
      status: COLLECTION_STATUS[0],
      productCategory: 'TEST',
      skuForecast: null,
      qtyForecast: null,
    });
    return { layoutId: layout.id, groupId: group.id, rowId: row.id };
  };

  const built = await buildLayout(outOfScopeBrandId);
  outRes.layoutId = built.layoutId;
  outRes.groupId = built.groupId;
  outRes.rowId = built.rowId;

  const quotation = await asAdmin.collectionLayout.quotations.create({
    rowId: outRes.rowId,
  });
  outRes.quotationId = quotation.id;

  // La revisione a mano: `create` valida `revisionTypeValue` contro un catalogo
  // che questa spec non ha motivo di seminare.
  const revision = await prisma.collectionLayoutRevision.create({
    data: {
      collectionLayoutId: outRes.layoutId,
      revisionNumber: 1,
      revisionTypeValue: 'TEST',
      cause: 'MANUAL',
      createdByUserId: admin.user.id,
    },
  });
  outRes.revisionId = revision.id;

  const inBuilt = await buildLayout(inScopeBrandId);
  inRes.layoutId = inBuilt.layoutId;
  inRes.rowId = inBuilt.rowId;
});

describe('brand scope — pricing', () => {
  /** Ogni caso: etichetta, e la chiamata parametrizzata sul brand. */
  const cases: [string, (session: UserSession, brandId: string) => Promise<unknown>][] = [
    ['export.pdf', (s, brandId) =>
      createCallerWithSession(s).pricing.export.pdf({ brandId, seasonId })],
    ['export.xlsx', (s, brandId) =>
      createCallerWithSession(s).pricing.export.xlsx({ brandId, seasonId })],
    ['parameterSets.list', (s, brandId) =>
      createCallerWithSession(s).pricing.parameterSets.list({ brandId, seasonId })],
  ];

  it.each(cases)('%s su un brand fuori scope → FORBIDDEN', async (_label, invoke) => {
    await expectUnauthorized(
      () => invoke(scopedSession, outOfScopeBrandId),
      'FORBIDDEN'
    );
  });

  it('il brand in scope non è bloccato dal guard', async () => {
    // `list` è la sola delle tre che non richiede parametri già esistenti:
    // superato il guard deve arrivare al risultato, non a un FORBIDDEN.
    await expect(
      createCallerWithSession(scopedSession).pricing.parameterSets.list({
        brandId: inScopeBrandId,
        seasonId,
      })
    ).resolves.toBeInstanceOf(Array);
  });

  it('un admin non è vincolato dagli scope di team', async () => {
    await expect(
      createCallerWithSession(adminSession).pricing.parameterSets.list({
        brandId: outOfScopeBrandId,
        seasonId,
      })
    ).resolves.toBeInstanceOf(Array);
  });
});

describe('brand scope — collectionLayout e dashboard', () => {
  it('collectionLayout.get su un brand fuori scope → FORBIDDEN', async () => {
    await expectUnauthorized(
      () =>
        createCallerWithSession(scopedSession).collectionLayout.get({
          brandId: outOfScopeBrandId,
          seasonId,
        }),
      'FORBIDDEN'
    );
  });

  it('dashboard.getSeasonProgress su un brand fuori scope → FORBIDDEN', async () => {
    await expectUnauthorized(
      () =>
        createCallerWithSession(scopedSession).dashboard.getSeasonProgress({
          brandId: outOfScopeBrandId,
          seasonId,
        }),
      'FORBIDDEN'
    );
  });
});

describe('brand scope — admin senza team', () => {
  /**
   * Un admin che non appartiene ad alcun team non deve essere vincolato.
   *
   * Prima dell'unificazione lo era: `assertBrandAccess` esisteva in due varianti,
   * e quella di `seasonCalendar.service.ts` aveva `userRole` **opzionale** con
   * tutti e 15 i chiamanti che lo omettevano. Senza quel parametro
   * `getUserAllowedBrandIds` non prendeva mai l'early return per gli admin,
   * quindi un admin senza team riceveva `[]` → FORBIDDEN su mezzo calendario
   * stagionale. La toppa era un `hasPermission({ role }, '*:*')` scritto a mano
   * nell'unico punto in cui qualcuno se n'era accorto.
   */
  it('seasonCalendar.getOrCreate risolve per un admin fuori da ogni team', async () => {
    await expect(
      createCallerWithSession(adminSession).seasonCalendar.getOrCreate({
        brandId: outOfScopeBrandId,
        seasonId,
      })
    ).resolves.toBeDefined();
  });

  it('un editor senza scope sul brand resta bloccato', async () => {
    await expectUnauthorized(
      () =>
        createCallerWithSession(scopedSession).seasonCalendar.getOrCreate({
          brandId: outOfScopeBrandId,
          seasonId,
        }),
      'FORBIDDEN'
    );
  });
});

describe('brand scope — risorse indirette', () => {
  /**
   * Le procedure che non nominano un brand nell'input, ma lo raggiungono
   * risolvendo il record: layout → gruppo → riga → quotazione, più le revisioni
   * e lo storico fasi. Sono invisibili a un controllo che guardi solo `brandId`,
   * ed erano tutte scoperte.
   *
   * Una procedura per `it` e non raggruppate: `configMutations` è 20/min per
   * utente, e `test/setup.ts` azzera lo store fra un test e l'altro. Raggruppate
   * finirebbero per far scattare il limite, producendo un TOO_MANY_REQUESTS
   * travestito da fallimento del guard.
   */
  const denied: [string, () => Promise<unknown>][] = [
    ['groups.create', () =>
      as().collectionLayout.groups.create({
        collectionLayoutId: outRes.layoutId,
        data: { name: 'X', order: 0 },
      })],
    ['groups.update', () =>
      as().collectionLayout.groups.update({ groupId: outRes.groupId, data: { name: 'X' } })],
    ['groups.delete', () =>
      as().collectionLayout.groups.delete({ groupId: outRes.groupId })],
    ['rows.create', () =>
      as().collectionLayout.rows.create({
        groupId: outRes.groupId,
        gender: 'UOMO',
        line: 'X',
        status: COLLECTION_STATUS[0],
        productCategory: 'TEST',
        skuForecast: null,
        qtyForecast: null,
      })],
    ['rows.update', () =>
      as().collectionLayout.rows.update({ rowId: outRes.rowId, data: { line: 'X' } })],
    ['rows.delete', () =>
      as().collectionLayout.rows.delete({ rowId: outRes.rowId })],
    ['rows.duplicate', () =>
      as().collectionLayout.rows.duplicate({ rowId: outRes.rowId })],
    ['rows.reorder', () =>
      as().collectionLayout.rows.reorder({ groupId: outRes.groupId, orderedIds: [outRes.rowId] })],
    ['rows.setCompleted', () =>
      as().collectionLayout.rows.setCompleted({ rowId: outRes.rowId, completed: true, note: 'motivazione di test' })],
    ['rows.bulkAssignPlanningGroup', () =>
      as().collectionLayout.rows.bulkAssignPlanningGroup({
        rowIds: [outRes.rowId],
        planningGroupId: randomUUID(),
      })],
    ['quotations.create', () =>
      as().collectionLayout.quotations.create({ rowId: outRes.rowId })],
    ['quotations.update', () =>
      as().collectionLayout.quotations.update({ quotationId: outRes.quotationId, data: {} })],
    ['quotations.delete', () =>
      as().collectionLayout.quotations.delete({ quotationId: outRes.quotationId })],
    ['quotations.reorder', () =>
      as().collectionLayout.quotations.reorder({
        rowId: outRes.rowId,
        orderedIds: [outRes.quotationId],
      })],
    ['updateSettings', () =>
      as().collectionLayout.updateSettings({ collectionLayoutId: outRes.layoutId })],
    ['revision.list', () =>
      as().collectionLayoutRevision.list({ collectionLayoutId: outRes.layoutId })],
    ['revision.getDetail', () =>
      as().collectionLayoutRevision.getDetail({ revisionId: outRes.revisionId })],
    ['revision.getLayoutAsOf', () =>
      as().collectionLayoutRevision.getLayoutAsOf({
        collectionLayoutId: outRes.layoutId,
        revisionId: outRes.revisionId,
      })],
    // `collectionLayoutId` non è più un input: se ricomparisse, questa riga non
    // compilerebbe. È il test che conta per il cross-layout — il runtime non può
    // più esprimere l'incoerenza.
    ['revision.export.xlsx', () =>
      as().collectionLayoutRevision.export.xlsx({ revisionId: outRes.revisionId })],
    ['phaseHistory.listForRow', () =>
      as().phaseHistory.listForRow({ rowId: outRes.rowId })],
    ['phaseHistory.layoutStats', () =>
      as().phaseHistory.layoutStats({ collectionLayoutId: outRes.layoutId })],
    ['phaseHistory.completionLeadTime', () =>
      as().phaseHistory.completionLeadTime({ collectionLayoutId: outRes.layoutId })],
  ];

  const as = () => createCallerWithSession(scopedSession);

  it.each(denied)('%s su una risorsa fuori scope → FORBIDDEN', async (_label, invoke) => {
    await expectUnauthorized(invoke, 'FORBIDDEN');
  });

  it('un id inesistente è NOT_FOUND, non FORBIDDEN', async () => {
    // L'ordine conta: un id che non esiste non è un problema di permessi, e
    // rispondere FORBIDDEN direbbe all'attaccante che qualcosa esiste.
    await expect(
      as().collectionLayout.groups.delete({ groupId: randomUUID() })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('la stessa procedura sul brand in scope non è bloccata', async () => {
    await expect(
      as().phaseHistory.layoutStats({ collectionLayoutId: inRes.layoutId })
    ).resolves.toBeInstanceOf(Array);
  });

  it('anche sulle risorse indirette in scope', async () => {
    await expect(
      as().phaseHistory.listForRow({ rowId: inRes.rowId })
    ).resolves.toBeInstanceOf(Array);
  });
});

describe('brand scope — copyFromSeason', () => {
  /**
   * Servono **entrambi** i guard, e una tabella con un solo verso non se ne
   * accorge: con il solo controllo sulla sorgente si scrive in un brand non
   * proprio; con il solo controllo sulla destinazione si legge la collezione di
   * un brand altrui clonandola in uno proprio.
   */
  it('sorgente fuori scope → FORBIDDEN', async () => {
    await expectUnauthorized(
      () =>
        createCallerWithSession(scopedSession).collectionLayout.copyFromSeason({
          fromBrandId: outOfScopeBrandId,
          fromSeasonId: seasonId,
          toBrandId: inScopeBrandId,
          toSeasonId: seasonId,
        }),
      'FORBIDDEN'
    );
  });

  it('destinazione fuori scope → FORBIDDEN', async () => {
    await expectUnauthorized(
      () =>
        createCallerWithSession(scopedSession).collectionLayout.copyFromSeason({
          fromBrandId: inScopeBrandId,
          fromSeasonId: seasonId,
          toBrandId: outOfScopeBrandId,
          toSeasonId: seasonId,
        }),
      'FORBIDDEN'
    );
  });
});

describe('reorder — gli id devono appartenere al parent', () => {
  /**
   * Classe diversa dal brand scope, trovata di fianco. `reorder` prendeva la
   * lista di id e faceva `update({ where: { id } })` su ognuno, senza filtrare
   * sul parent: bastava un `rowId` legittimo per riordinare le quotazioni di una
   * riga altrui. Il guard di brand non lo intercetta, perché il `rowId` passato
   * è davvero tuo.
   */
  it('una quotazione di un\'altra riga non viene toccata', async () => {
    const asAdmin = createCallerWithSession(adminSession);

    // Due righe distinte, ciascuna con la sua quotazione.
    const mine = await asAdmin.collectionLayout.rows.create({
      groupId: outRes.groupId,
      gender: 'UOMO',
      line: 'Mia',
      status: COLLECTION_STATUS[0],
      productCategory: 'TEST',
      skuForecast: null,
      qtyForecast: null,
    });
    const mineQuotation = await asAdmin.collectionLayout.quotations.create({
      rowId: mine.id,
    });
    const foreignQuotation = await asAdmin.collectionLayout.quotations.create({
      rowId: outRes.rowId,
    });

    const before = await prisma.collectionRowQuotation.findUnique({
      where: { id: foreignQuotation.id },
      select: { order: true, rowId: true },
    });

    // Riordino "la mia" riga, ma infilo nella lista la quotazione altrui in
    // posizione 0 — che è ciò che ne cambierebbe l'ordine.
    await asAdmin.collectionLayout.quotations.reorder({
      rowId: mine.id,
      orderedIds: [foreignQuotation.id, mineQuotation.id],
    });

    const after = await prisma.collectionRowQuotation.findUnique({
      where: { id: foreignQuotation.id },
      select: { order: true, rowId: true },
    });

    expect(after).toEqual(before);
  });
});
