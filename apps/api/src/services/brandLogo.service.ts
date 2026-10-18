import { TRPCError } from '@trpc/server';

import { calcBackoffDelay, type StorageBucket } from '@luke/core';

import { logAudit } from '../lib/auditLog';
import { getStorageProvider, deleteObjectByKey } from '../storage';

import { ingestImageAsset } from './asset.service';

import type { Context } from '../lib/trpc';

/**
 * Uploads a brand logo to the pending bucket without linking it to any brand.
 * The caller must confirm the upload via the brand save flow.
 *
 * @returns Public URL and file object ID for the pending logo.
 * @throws {TRPCError} BAD_REQUEST if the file type or magic bytes are invalid.
 */
export async function uploadTempBrandLogo(
  ctx: Context,
  params: {
    file: {
      filename: string;
      mimetype: string;
      stream: NodeJS.ReadableStream;
      size: number;
    };
  }
): Promise<{ publicUrl: string; fileObjectId: string }> {
  const result = await ingestImageAsset(ctx, {
    kind: 'brand-logo',
    file: params.file,
    pending: true,
  });

  try {
    await logAudit(ctx, {
      action: 'BRAND_PENDING_LOGO_UPLOADED',
      targetType: 'FileObject',
      targetId: result.fileObjectId,
      result: 'SUCCESS',
      metadata: { filename: result.originalName, size: params.file.size, contentType: params.file.mimetype },
    });
  } catch (auditError) {
    ctx.logger?.warn({ auditError }, 'Audit log failed for pending brand logo upload');
  }

  return { publicUrl: result.publicUrl, fileObjectId: result.fileObjectId };
}

/**
 * Uploads a new logo for an existing brand, updates the brand record, and schedules
 * asynchronous deletion of the previous logo file.
 *
 * @returns Public URL, bucket name, and storage key of the new logo.
 * @throws {TRPCError} BAD_REQUEST if the file is invalid. NOT_FOUND if the brand does not exist.
 */
export async function uploadBrandLogo(
  ctx: Context,
  params: {
    brandId: string;
    file: {
      filename: string;
      mimetype: string;
      stream: NodeJS.ReadableStream;
      size: number;
    };
  }
): Promise<{ publicUrl: string; bucket: string; key: string }> {
  // Brand existence is checked before uploading (not after): a confirmed (non-pending)
  // upload for a brand that turns out not to exist would leave an orphaned FileObject
  // the reaper never touches — it only sweeps *pending* files (see `setupTempFileCleanup`
  // in `server.ts`).
  const brand = await ctx.prisma.brand.findUnique({ where: { id: params.brandId } });

  if (!brand) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Brand non trovato' });
  }

  const result = await ingestImageAsset(ctx, { kind: 'brand-logo', file: params.file });

  await ctx.prisma.brand.update({
    where: { id: params.brandId },
    data: { logoKey: result.key },
  });

  if (brand.logoKey) {
    setImmediate(async () => {
      try {
        await deleteObjectByKey(ctx, { bucket: 'brand-logos', key: brand.logoKey! });
      } catch (err) {
        ctx.logger?.warn({ err }, 'Failed to cleanup old logo');
      }
    });
  }

  try {
    await logAudit(ctx, {
      action: 'BRAND_LOGO_UPLOADED',
      targetType: 'Brand',
      targetId: params.brandId,
      result: 'SUCCESS',
      metadata: {
        filename: result.originalName,
        originalFilename: params.file.filename,
        size: params.file.size,
        contentType: params.file.mimetype,
        oldLogoKey: brand.logoKey,
      },
    });
  } catch (auditError) {
    ctx.logger?.warn({ auditError }, 'Audit log failed for brand logo upload');
  }

  return { publicUrl: result.publicUrl, bucket: result.bucket, key: result.key };
}

/**
 * Deletes a file from storage with exponential back-off retry. Updates the FileObject
 * cleanup status in the database on success or final failure.
 *
 * @param maxRetries - Maximum number of attempts (default 3).
 * @param baseDelay - Initial delay in milliseconds before the first retry (default 100).
 * @returns true if the file was deleted successfully, false after all retries are exhausted.
 */
export async function deleteFileWithRetry(
  ctx: Context,
  params: {
    bucket: StorageBucket;
    key: string;
    fileId?: string;
  },
  maxRetries: number = 3,
  baseDelay: number = 100
): Promise<boolean> {
  const { bucket, key, fileId } = params;
  const now = new Date();

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const provider = await getStorageProvider(ctx.prisma);
      await provider.delete({ bucket, key });

      if (fileId) {
        try {
          await ctx.prisma.fileObject.update({
            where: { id: fileId },
            data: { cleanupStatus: 'SUCCESS', lastCleanupAt: now },
          });
        } catch (updateError) {
          ctx.logger?.warn({ updateError, fileId }, 'Failed to update cleanup status after successful delete');
        }
      }

      ctx.logger?.info({ bucket, key, attempt: attempt + 1 }, 'File deleted successfully');
      return true;
    } catch (error) {
      if (attempt === maxRetries - 1) {
        if (fileId) {
          try {
            await ctx.prisma.fileObject.update({
              where: { id: fileId },
              data: { cleanupStatus: 'FAILED', cleanupAttempts: attempt + 1, lastCleanupAt: now },
            });
          } catch (updateError) {
            ctx.logger?.warn({ updateError, fileId }, 'Failed to update cleanup status after all retries failed');
          }
        }

        ctx.logger?.warn({ error, bucket, key, attempts: attempt + 1 }, 'File delete failed after all retries');
        return false;
      }

      const delay = calcBackoffDelay(attempt, baseDelay);
      await new Promise(resolve => setTimeout(resolve, delay));
      ctx.logger?.debug({ bucket, key, attempt: attempt + 1, nextDelay: delay }, 'File delete attempt failed, retrying...');
    }
  }

  return false;
}

/**
 * Retries storage deletion for FileObjects whose previous cleanup attempts failed,
 * skipping those that have already had 5 or more attempts or were cleaned up less
 * than 1 hour ago.
 *
 * @returns Number of files successfully deleted in this run.
 */
export async function retryFailedCleanups(ctx: Context): Promise<number> {
  try {
    const failedFiles = await ctx.prisma.fileObject.findMany({
      where: {
        cleanupStatus: 'FAILED',
        cleanupAttempts: { lt: 5 },
        lastCleanupAt: { lt: new Date(Date.now() - 60 * 60 * 1000) },
      },
      select: { id: true, bucket: true, key: true },
    });

    let successCount = 0;

    for (const file of failedFiles) {
      const success = await deleteFileWithRetry(
        ctx,
        { bucket: file.bucket as StorageBucket, key: file.key, fileId: file.id },
        3,
        100
      );
      if (success) successCount++;
    }

    if (successCount > 0 || failedFiles.length > 0) {
      ctx.logger?.info({ total: failedFiles.length, succeeded: successCount }, 'Cleanup retry job completed');
    }

    return successCount;
  } catch (error) {
    ctx.logger?.error({ error }, 'Fatal error in retryFailedCleanups background job');
    return 0;
  }
}
