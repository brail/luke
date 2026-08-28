/**
 * Covers the pg_restore/server version preflight.
 *
 * Both outcomes are exercised wherever this runs: the server version comes from the database, the
 * client version from the binary on PATH, so one of the two branches is the real local situation
 * and the other is driven with a stubbed reading. No skip — unlike the restore suite itself, this
 * check is what a skewed toolchain is *supposed* to reject, so a skewed machine is a valid place
 * to test it.
 */

import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { pgBinaryMajorVersion } from '../src/lib/backup/pgConnection';
import { assertPgToolchainCompatible } from '../src/lib/backup/restorePipeline';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DATABASE_URL)('preflight versioni pg', () => {
  let prisma: PrismaClient;
  let clientMajor: number;
  let serverMajor: number;

  beforeAll(async () => {
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: TEST_DATABASE_URL! }) });
    clientMajor = await pgBinaryMajorVersion('pg_restore');
    const rows = await prisma.$queryRaw<{ server_version: string }[]>`SHOW server_version`;
    serverMajor = Number.parseInt(rows[0].server_version, 10);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('riflette la situazione reale della macchina', async () => {
    const check = assertPgToolchainCompatible(prisma);
    if (clientMajor === serverMajor) {
      await expect(check).resolves.toBeUndefined();
    } else {
      // Il messaggio deve nominare entrambe le versioni: senza, l'admin vede solo
      // "unrecognized configuration parameter" e non sa cosa allineare.
      await expect(check).rejects.toThrow(new RegExp(`${clientMajor}.*${serverMajor}`));
    }
  });

  it('rifiuta quando il client è più recente del server', async () => {
    vi.spyOn(prisma, '$queryRaw').mockResolvedValueOnce([{ server_version: `${clientMajor - 1}.4` }]);
    await expect(assertPgToolchainCompatible(prisma)).rejects.toThrow(/pg_restore è alla major/);
    vi.restoreAllMocks();
  });

  it('accetta quando le major coincidono', async () => {
    vi.spyOn(prisma, '$queryRaw').mockResolvedValueOnce([{ server_version: `${clientMajor}.4` }]);
    await expect(assertPgToolchainCompatible(prisma)).resolves.toBeUndefined();
    vi.restoreAllMocks();
  });

  it('non prova a indovinare se la versione del server è illeggibile', async () => {
    vi.spyOn(prisma, '$queryRaw').mockResolvedValueOnce([{ server_version: 'boh' }]);
    await expect(assertPgToolchainCompatible(prisma)).rejects.toThrow(/Impossibile determinare/);
    vi.restoreAllMocks();
  });
});
