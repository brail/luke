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
