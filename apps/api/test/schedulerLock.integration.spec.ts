/**
 * Test di integrazione per `withSchedulerLock` (apps/api/src/lib/schedulerLock.ts).
 *
 * Serve una tabella Prisma reale (`scheduler_locks`, upsert condizionale via raw SQL):
 * mockare `prisma.$queryRaw` testerebbe solo che la query viene chiamata, non che
 * l'esclusione reciproca funzioni davvero — da qui il tier integration, non unit.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { withSchedulerLock } from '../src/lib/schedulerLock';

import { setupTestDb } from './helpers';

describe('withSchedulerLock', () => {
  let testPrisma: Awaited<ReturnType<typeof setupTestDb>>;

  beforeEach(async () => {
    testPrisma = await setupTestDb();
  });

  it('esegue il tick quando nessun altro lock è presente', async () => {
    const tick = vi.fn(async () => 'done');

    const result = await withSchedulerLock(testPrisma, 'backup', tick)();

    expect(result).toBe('done');
    expect(tick).toHaveBeenCalledTimes(1);
  });

  it("salta il tick se un'altra istanza detiene già il lock (non scaduto)", async () => {
    await testPrisma.schedulerLock.create({
      data: { name: 'backup', heldBy: 'other-instance', expiresAt: new Date(Date.now() + 60_000) },
    });

    const tick = vi.fn(async () => 'done');
    const result = await withSchedulerLock(testPrisma, 'backup', tick)();

    // undefined distingue "saltato" da "il tick ha ritornato undefined" — qui l'unico
    // modo in cui può succedere è che l'acquisizione del lock abbia fallito.
    expect(result).toBeUndefined();
    expect(tick).not.toHaveBeenCalled();

    // Verifica anche sul DB, non solo sul risultato: il lock preso da 'other-instance' non
    // deve essere stato sovrascritto dal tentativo fallito.
    const row = await testPrisma.schedulerLock.findUniqueOrThrow({ where: { name: 'backup' } });
    expect(row.heldBy).toBe('other-instance');
  });

  it("riacquisisce il lock se quello esistente è scaduto (crash di un'altra istanza)", async () => {
    await testPrisma.schedulerLock.create({
      data: { name: 'backup', heldBy: 'crashed-instance', expiresAt: new Date(Date.now() - 1000) },
    });

    const tick = vi.fn(async () => 'done');
    const result = await withSchedulerLock(testPrisma, 'backup', tick)();

    expect(result).toBe('done');
    expect(tick).toHaveBeenCalledTimes(1);
  });

  it('rilascia il lock subito dopo un tick riuscito, non aspettando il TTL', async () => {
    await withSchedulerLock(testPrisma, 'backup', vi.fn(async () => 'done'))();

    // Se il rilascio non fosse esplicito, questa seconda chiamata troverebbe
    // expiresAt ancora nel futuro (TTL 15 min) e verrebbe saltata.
    const tick2 = vi.fn(async () => 'done');
    const result = await withSchedulerLock(testPrisma, 'backup', tick2)();

    expect(result).toBe('done');
    expect(tick2).toHaveBeenCalledTimes(1);
  });

  it('rilascia il lock anche se il tick lancia un errore', async () => {
    const failingTick = vi.fn(async () => { throw new Error('boom'); });
    await expect(withSchedulerLock(testPrisma, 'backup', failingTick)()).rejects.toThrow('boom');

    const tick2 = vi.fn(async () => 'done');
    const result = await withSchedulerLock(testPrisma, 'backup', tick2)();

    expect(result).toBe('done');
    expect(tick2).toHaveBeenCalledTimes(1);
  });

  it('lock su nomi diversi sono indipendenti (nav-sync per-entità non si serializzano a vicenda)', async () => {
    await testPrisma.schedulerLock.create({
      data: { name: 'nav-sync:vendor', heldBy: 'other-instance', expiresAt: new Date(Date.now() + 60_000) },
    });

    // Un bug plausibile: usare un'unica chiave 'nav-sync' condivisa fra le entità
    // invece del nome per-entità — questo test fallirebbe in quel caso, perché
    // 'nav-sync:brand' verrebbe bloccato dal lock preso su 'nav-sync:vendor'.
    const tick = vi.fn(async () => 'done');
    const result = await withSchedulerLock(testPrisma, 'nav-sync:brand', tick)();

    expect(result).toBe('done');
    expect(tick).toHaveBeenCalledTimes(1);
  });
});
