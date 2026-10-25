/**
 * `getRequireEmailVerification` reads `auth.requireEmailVerification` through the registry. A stored
 * value the registry refuses — an encrypted row included, since the read does not decrypt — reads as
 * `true`: the gate then refuses what `true` refuses, never less. A database failure is thrown.
 */
import { describe, expect, it, vi } from 'vitest';

import type { PrismaClient } from '@luke/db';

import { encryptValue, getRequireEmailVerification } from '../src/lib/configManager';

function prismaWith(row: { value: string; isEncrypted: boolean } | null): PrismaClient {
  const findUnique = vi.fn(async ({ where: { key } }: { where: { key: string } }) => (row ? { key, ...row } : null));
  // Only `appConfig.findUnique` is reached: the key is one row.
  return { appConfig: { findUnique } } as unknown as PrismaClient;
}

describe('getRequireEmailVerification', () => {
  it('is off when nothing is stored', async () => {
    await expect(getRequireEmailVerification(prismaWith(null))).resolves.toBe(false);
  });

  it.each([
    ['true', true],
    ['false', false],
  ])('reads a stored %s', async (value, expected) => {
    await expect(getRequireEmailVerification(prismaWith({ value, isEncrypted: false }))).resolves.toBe(expected);
  });

  it.each([
    ['a value the registry refuses', { value: 'yes', isEncrypted: false }],
    ['a row that does not decrypt', { value: 'v1:3q2+7w==:c2VjcmV0', isEncrypted: true }],
  ])('reads %s as required', async (_label, row) => {
    await expect(getRequireEmailVerification(prismaWith(row))).resolves.toBe(true);
  });

  it('reads an encrypted row by its plaintext', async () => {
    await expect(
      getRequireEmailVerification(prismaWith({ value: encryptValue('false'), isEncrypted: true })),
    ).resolves.toBe(false);
  });

  it('throws a database failure', async () => {
    const findUnique = vi.fn(async () => {
      throw new Error('connection lost');
    });
    const prisma = { appConfig: { findUnique } } as unknown as PrismaClient;
    await expect(getRequireEmailVerification(prisma)).rejects.toThrow('connection lost');
  });
});
