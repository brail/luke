import { TRPCError } from '@trpc/server';
import { Readable } from 'stream';

import { type StorageBucket } from '@luke/core';

import { streamToBuffer, validateMagicBytes, validateImageFile } from '../lib/imageUpload';
import { resolvePublicUrl } from '../lib/storageUrl';
import { logAudit } from '../lib/auditLog';
import { putObject, deleteObjectByKey, getStorageProvider } from '../storage';
import type { Context } from '../lib/trpc';

const IMAGE_CONFIG = {
  allowedMimes: ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'] as const,
  maxSizeBytes: 2 * 1024 * 1024,
  allowedExtensions: ['.png', '.jpg', '.jpeg', '.webp'] as const,
};

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
  const sanitizedFilename = validateImageFile(params.file, IMAGE_CONFIG);

  const buffer = await streamToBuffer(params.file.stream);

  if (!validateMagicBytes(buffer, params.file.mimetype)) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'File corrotto o tipo non valido' });
  }

  const fileObject = await putObject(ctx, {
    bucket: 'brand-logos',
    originalName: sanitizedFilename,
    contentType: params.file.mimetype,
    size: params.file.size,
    stream: Readable.from(buffer),
    pending: true,
  });

  const publicUrl = await resolvePublicUrl(ctx.prisma, 'brand-logos', fileObject.key);

  try {
    await logAudit(ctx, {
      action: 'BRAND_PENDING_LOGO_UPLOADED',
      targetType: 'FileObject',
      targetId: fileObject.id,
      result: 'SUCCESS',
      metadata: { filename: sanitizedFilename, size: params.file.size, contentType: params.file.mimetype },
    });
  } catch (auditError) {
    ctx.logger?.warn({ auditError }, 'Audit log failed for pending brand logo upload');
  }

  return { publicUrl, fileObjectId: fileObject.id };
}

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
  const sanitizedFilename = validateImageFile(params.file, IMAGE_CONFIG);

  const buffer = await streamToBuffer(params.file.stream);

  if (!validateMagicBytes(buffer, params.file.mimetype)) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'File corrotto o tipo non valido' });
  }

  const brand = await ctx.prisma.brand.findUnique({ where: { id: params.brandId } });

  if (!brand) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Brand non trovato' });
  }

  const fileObject = await putObject(ctx, {
    bucket: 'brand-logos',
    originalName: sanitizedFilename,
    contentType: params.file.mimetype,
    size: params.file.size,
    stream: Readable.from(buffer),
  });

  await ctx.prisma.brand.update({
    where: { id: params.brandId },
    data: { logoKey: fileObject.key },
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
        filename: sanitizedFilename,
        originalFilename: params.file.filename,
        size: params.file.size,
        contentType: params.file.mimetype,
        oldLogoKey: brand.logoKey,
      },
    });
  } catch (auditError) {
    ctx.logger?.warn({ auditError }, 'Audit log failed for brand logo upload');
  }

  const publicUrl = await resolvePublicUrl(ctx.prisma, 'brand-logos', fileObject.key);
  return { publicUrl, bucket: 'brand-logos', key: fileObject.key };
}

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

      const delay = baseDelay * Math.pow(2, attempt);
      await new Promise(resolve => setTimeout(resolve, delay));
      ctx.logger?.debug({ bucket, key, attempt: attempt + 1, nextDelay: delay }, 'File delete attempt failed, retrying...');
    }
  }

  return false;
}

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
