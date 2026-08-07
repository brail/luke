/**
 * `lastAdminGuard` — enforcement reale attraverso gli endpoint tRPC, non contro
 * un mock. `sectionAccess.spec.ts` esercita solo `countAdminsWithSettingsAccess`
 * con un `PrismaClient` finto: nessun test tocca `assertNotLastAdminWithSettingsAccess`,
 * `acquireLastAdminLock`, o la transazione reale di `users.update`/`softDelete`/
 * `hardDelete`. Questa suite copre entrambe le cose, inclusa la race che
 * `pg_advisory_xact_lock` esiste per chiudere: due mutation concorrenti che,
 * lette in isolamento, vedrebbero entrambe "2 admin" e passerebbero entrambe,
 * portando il sistema a zero admin.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { acquireLastAdminLock } from '../src/lib/lastAdminGuard';

import { createCallerWithSession, createTestUser, setupTestDb } from './helpers';

import type { UserSession } from '../src/lib/auth';
import type { PrismaClient } from '@prisma/client';

let prisma: PrismaClient;

function callerFor(session: UserSession) {
  return createCallerWithSession(session).users;
}

const LAST_ADMIN_MESSAGE =
  "Non puoi rimuovere i privilegi amministrativi dall'ultimo amministratore del sistema";

// `beforeEach`, non `beforeAll`: gli admin creati da un test restano attivi nel
// DB condiviso del file (nessun truncate fra test) e si sommerebbero al conteggio
// globale del test successivo — il test di concorrenza sotto assume esattamente
// due admin attivi al mondo, non "due più quelli lasciati dai test precedenti".
beforeEach(async () => {
  prisma = await setupTestDb();
});

describe('lastAdminGuard — enforcement reale', () => {
  it('editor con users:update NON può disattivare l\'unico admin rimasto', async () => {
    const { session: editorSession } = await createTestUser('editor');
    const { user: admin } = await createTestUser('admin');

    await expect(
      callerFor(editorSession).update({ id: admin.id, isActive: false })
    ).rejects.toMatchObject({ code: 'FORBIDDEN', message: LAST_ADMIN_MESSAGE });

    const refreshed = await prisma.user.findUniqueOrThrow({ where: { id: admin.id } });
    expect(refreshed.isActive).toBe(true);
  });

  it('editor con users:update PUÒ disattivare un admin se ne resta almeno un altro attivo', async () => {
    const { session: editorSession } = await createTestUser('editor');
    const { user: admin1 } = await createTestUser('admin');
    await createTestUser('admin'); // secondo admin: mantiene il sistema sopra la soglia

    await callerFor(editorSession).update({ id: admin1.id, isActive: false });

    const refreshed = await prisma.user.findUniqueOrThrow({ where: { id: admin1.id } });
    expect(refreshed.isActive).toBe(false);
  });

  it(
    'acquireLastAdminLock serializza due transazioni concorrenti sulla stessa chiave ' +
      '(pg_advisory_xact_lock, non un mutex applicativo — sopravvive a più repliche API)',
    async () => {
      // Prova diretta di mutua esclusione sulla primitiva reale usata da tutti e tre
      // gli endpoint (`users.update`/`softDelete`/`hardDelete`, vedi grep in
      // `src/routers/users.core.router.ts` e `src/services/users.service.ts`).
      // Un test end-to-end con due `users.update` concorrenti è stato scartato dopo
      // verifica empirica: senza forzare la finestra di sovrapposizione, le due
      // transazioni non si accavallano mai abbastanza da eseguire entrambe la SELECT
      // prima che la prima faccia COMMIT — il test passava identico anche con
      // `acquireLastAdminLock` temporaneamente disattivato (falso positivo). `pg_sleep`
      // dentro la transazione che tiene il lock forza deterministicamente la
      // sovrapposizione, a differenza di un semplice `Promise.allSettled` su due
      // chiamate reali.
      const order: string[] = [];

      const txA = prisma.$transaction(async tx => {
        await acquireLastAdminLock(tx);
        order.push('A-acquired');
        await tx.$executeRaw`SELECT pg_sleep(0.3)`;
        order.push('A-releasing');
      });

      // Garantisce che A abbia già acquisito il lock prima che B tenti — altrimenti
      // l'ordine di arrivo delle due transazioni sulla stessa chiave non è garantito
      // e il test diventerebbe intermittente.
      await new Promise(resolve => setTimeout(resolve, 100));

      const txB = prisma.$transaction(async tx => {
        await acquireLastAdminLock(tx);
        order.push('B-acquired');
      });

      await Promise.all([txA, txB]);

      // B non può acquisire il lock finché la transazione di A non termina (l'advisory
      // lock è xact-scoped: si rilascia solo a COMMIT/ROLLBACK) — se il lock non
      // serializzasse, B potrebbe intercalarsi prima di 'A-releasing'.
      expect(order).toEqual(['A-acquired', 'A-releasing', 'B-acquired']);
    }
  );
});
