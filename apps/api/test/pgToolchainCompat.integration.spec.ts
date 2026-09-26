/**
 * Covers the pg_restore/server version preflight.
 *
 * Both outcomes are exercised wherever this runs: the server version comes from the database, the
 * client version from the binary on PATH, so one of the two branches is the real local situation
 * and the other is driven with a stubbed reading. No skip — unlike the restore suite itself, this
 * check is what a skewed toolchain is *supposed* to reject, so a skewed machine is a valid place
 * to test it.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createPrismaClient, type PrismaClient } from '@luke/db';

import { pgBinaryMajorVersion } from '../src/lib/backup/pgConnection';
import { assertPgToolchainCompatible } from '../src/lib/backup/restorePipeline';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DATABASE_URL)('preflight versioni pg', () => {
  let prisma: PrismaClient;
  let clientMajor: number;
  let serverMajor: number;

  beforeAll(async () => {
    prisma = createPrismaClient({ connectionString: TEST_DATABASE_URL });
    clientMajor = await pgBinaryMajorVersion('pg_restore');
    const rows = await prisma.$queryRaw<{ server_version: string }[]>`SHOW server_version`;
    serverMajor = Number.parseInt(rows[0].server_version, 10);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('reflects the real state of the machine', async () => {
    const check = assertPgToolchainCompatible(prisma);
    if (clientMajor === serverMajor) {
      await expect(check).resolves.toBeUndefined();
    } else {
      // The message has to name both versions: without them the admin only sees
      // "unrecognized configuration parameter" and has no idea what to align.
      await expect(check).rejects.toThrow(new RegExp(`${clientMajor}.*${serverMajor}`));
    }
  });

  it('refuses when the client is newer than the server', async () => {
    vi.spyOn(prisma, '$queryRaw').mockResolvedValueOnce([{ server_version: `${clientMajor - 1}.4` }]);
    await expect(assertPgToolchainCompatible(prisma)).rejects.toThrow(/pg_restore è alla major/);
    vi.restoreAllMocks();
  });

  it('accepts when the majors match', async () => {
    vi.spyOn(prisma, '$queryRaw').mockResolvedValueOnce([{ server_version: `${clientMajor}.4` }]);
    await expect(assertPgToolchainCompatible(prisma)).resolves.toBeUndefined();
    vi.restoreAllMocks();
  });

  it('does not try to guess when the server version is unreadable', async () => {
    vi.spyOn(prisma, '$queryRaw').mockResolvedValueOnce([{ server_version: 'boh' }]);
    await expect(assertPgToolchainCompatible(prisma)).rejects.toThrow(/Impossibile determinare/);
    vi.restoreAllMocks();
  });
});
