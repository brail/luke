/**
 * Pure engine layer for importing a passphrase-protected `.lukebak` export package — the
 * counterpart to `dumpPipeline.ts`/`restorePipeline.ts`. Same separation of concerns: no tRPC
 * Context, no audit logging — the caller (the raw Fastify route) owns request context and is
 * responsible for `logAudit` once this resolves.
 *
 * Flow: parse the envelope → recover the DEK via the passphrase (wrong passphrase → GCM
 * auth-tag mismatch, thrown as `BackupImportValidationError`) → re-wrap it with *this* server's
 * master key → store the ciphertext body (unchanged bytes) under a fresh id → create a
 * COMPLETED `BackupRecord` with trigger `IMPORTED`. From there the existing, unmodified restore
 * mutation/dialog takes over.
 */

import { randomUUID } from 'crypto';

import type { BackupScope, PrismaClient } from '@luke/db';

import { getStorageProvider } from '../../storage';
import { getBackupRetentionDays } from '../configManager';

import { unwrapDekWithPassphrase, wrapDek } from './crypto';
import { backupBlobKey, computeBackupExpiresAt } from './dumpPipeline';
import { splitExportEnvelope } from './exportFormat';


/** Thrown for any client-fixable problem (bad passphrase, corrupt/truncated package, checksum mismatch) — the route maps this to a 400, anything else to a 500. */
export class BackupImportValidationError extends Error {}

export interface RunImportJobParams {
  prisma: PrismaClient;
  fileStream: NodeJS.ReadableStream;
  passphrase: string;
  label?: string;
  createdById: string;
}

export async function runImportJob(params: RunImportJobParams): Promise<{ id: string; scope: BackupScope }> {
  const { prisma, fileStream, passphrase, label, createdById } = params;

  let header;
  let body;
  try {
    ({ header, body } = await splitExportEnvelope(fileStream));
  } catch {
    throw new BackupImportValidationError('Pacchetto di export non valido o corrotto');
  }

  let dek: Buffer;
  try {
    dek = await unwrapDekWithPassphrase(header.passphraseWrapped, passphrase);
  } catch {
    throw new BackupImportValidationError('Passphrase errata o file non valido');
  }

  const newId = randomUUID();
  const blobKey = backupBlobKey(newId);

  const [provider, retentionDays] = await Promise.all([
    getStorageProvider(prisma),
    getBackupRetentionDays(prisma),
  ]);

  const uploadResult = await provider.put({
    bucket: 'backups',
    key: blobKey,
    originalName: blobKey,
    contentType: 'application/octet-stream',
    size: 0,
    stream: body,
  });

  if (uploadResult.checksumSha256 !== header.checksumSha256) {
    await provider.delete({ bucket: 'backups', key: blobKey }).catch(() => { /* best-effort */ });
    throw new BackupImportValidationError('Pacchetto corrotto: checksum non corrispondente');
  }

  const record = await prisma.backupRecord.create({
    data: {
      id: newId,
      filename: blobKey,
      scope: header.scope,
      trigger: 'IMPORTED',
      status: 'COMPLETED',
      label: label ?? null,
      sizeBytesEncrypted: BigInt(uploadResult.size),
      checksumSha256: uploadResult.checksumSha256,
      ivHex: header.bodyIvHex,
      authTagHex: header.bodyAuthTagHex,
      wrappedDekHex: wrapDek(dek),
      appVersion: header.appVersion,
      schemaMigrationName: header.schemaMigrationName,
      createdById,
      expiresAt: computeBackupExpiresAt(retentionDays),
      completedAt: new Date(),
    },
  });

  return { id: record.id, scope: record.scope };
}
