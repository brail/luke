/**
 * What `encrypt-secret-config.ts` does: encrypts, in place, the `SECRET_CONFIG_KEYS` rows an
 * earlier release stored in plaintext. Kept apart from the entry point so it can be tested
 * against a database.
 */

import { existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

import { CONFIG_SECRET_PLACEHOLDER, SECRET_CONFIG_KEYS, isSecretConfigKey, validateConfigValue } from '@luke/core';
import type { PrismaClient } from '@luke/db';

import { logAudit } from '../../src/lib/auditLog.js';
import { decryptValue, encryptValue } from '../../src/lib/configManager.js';

/** Where the API keeps its master key (`getMasterKey` in `@luke/core/server`). */
const MASTER_KEY_PATH = join(homedir(), '.luke', 'secret.key');

/** The script stops before writing anything: the reason is safe to print. */
export class EncryptSecretsRefused extends Error {}

/** What the run did, by key only — never a value. */
export interface EncryptSecretsReport {
  /** Rows encrypted, or that a dry run would encrypt. */
  encrypted: string[];
  /** Plaintext rows their registry schema refuses: left as they are, for the operator to fix. */
  invalid: Array<{ key: string; message: string }>;
  /** Rows that changed between the read and the write: left alone, a re-run picks them up. */
  changedConcurrently: string[];
  /** Rows whose write failed: left in plaintext, a re-run retries them. */
  failed: string[];
}

export async function encryptPlainSecretRows(
  prisma: PrismaClient,
  options: { dryRun?: boolean; masterKeyPath?: string } = {}
): Promise<EncryptSecretsReport> {
  const report: EncryptSecretsReport = { encrypted: [], invalid: [], changedConcurrently: [], failed: [] };
  const rows = await prisma.appConfig.findMany({
    where: { key: { in: [...SECRET_CONFIG_KEYS] }, isEncrypted: false },
    select: { key: true, value: true },
    orderBy: { key: 'asc' },
  });
  if (rows.length === 0) return report;

  // `getMasterKey` creates a key when the file is missing: encrypting under a key the API does not
  // hold would make every row this script touches unreadable.
  // ponytail: duplicates the private MASTER_KEY_PATH of `secrets.server.ts`; export it from there if
  // the key ever moves.
  if (!existsSync(options.masterKeyPath ?? MASTER_KEY_PATH)) {
    throw new EncryptSecretsRefused(
      'no master key file: run inside the API container, whose volume holds the key the rows were encrypted with'
    );
  }
  // Run against the right database with the wrong key (a laptop's, through a tunnel), nothing
  // already encrypted decrypts. One row is enough to tell: a database cloned from another instance
  // keeps rows under that instance's key next to its own.
  const encryptedRows = await prisma.appConfig.findMany({ where: { isEncrypted: true }, select: { value: true } });
  if (encryptedRows.length > 0 && !encryptedRows.some(({ value }) => decrypts(value))) {
    throw new EncryptSecretsRefused('the master key decrypts none of the encrypted rows: not the key the API uses');
  }

  for (const { key, value } of rows) {
    if (!isSecretConfigKey(key)) continue; // `findMany` filtered on the list: narrows the type
    const verdict = validateConfigValue(key, value);
    if (!verdict.success) {
      report.invalid.push({ key, message: verdict.message });
      continue;
    }
    if (options.dryRun) {
      report.encrypted.push(key);
      continue;
    }
    // One transaction per key: a failure leaves the keys before it encrypted, and reported.
    try {
      const written = await prisma.$transaction(async tx => {
        // Conditional on the plaintext read above: a row rewritten meanwhile is not overwritten.
        const { count } = await tx.appConfig.updateMany({
          where: { key, value, isEncrypted: false },
          data: { value: encryptValue(value), isEncrypted: true, updatedAt: new Date() },
        });
        if (count === 0) return false;
        await logAudit(
          { prisma: tx },
          {
            action: 'CONFIG_UPSERT',
            targetType: 'Config',
            targetId: key,
            result: 'SUCCESS',
            metadata: { key, isEncrypted: true, valueRedacted: CONFIG_SECRET_PLACEHOLDER, source: 'cli' },
          },
          { required: true }
        );
        return true;
      });
      (written ? report.encrypted : report.changedConcurrently).push(key);
    } catch {
      // Not the error: a database error can quote the statement's parameters, the plaintext among them.
      report.failed.push(key);
    }
  }

  return report;
}

function decrypts(value: string): boolean {
  try {
    decryptValue(value);
    return true;
  } catch {
    return false;
  }
}
