import { TRPCError } from '@trpc/server';

import { logAudit } from '../lib/auditLog';

import { ingestImageAsset } from './asset.service';

import type { Context } from '../lib/trpc';

/**
 * Validates and stores an image file for a merchandising specsheet.
 * Validates MIME type, file size, extension, and magic bytes before storage.
 * Automatically sets the first uploaded image as the default.
 *
 * @returns The new image record ID and its resolved public URL.
 * @throws {TRPCError} BAD_REQUEST if the file is corrupted or the type is invalid.
 * @throws {TRPCError} NOT_FOUND if the specsheet does not exist.
 */
export async function uploadSpecsheetImage(
  ctx: Context,
  params: {
    specsheetId: string;
    caption?: string;
    file: {
      filename: string;
      mimetype: string;
      stream: NodeJS.ReadableStream;
      size: number;
    };
  }
): Promise<{ id: string; publicUrl: string }> {
  // Specsheet existence is checked before uploading: a confirmed (non-pending) upload
  // for a specsheet that doesn't exist would leave an orphaned FileObject the reaper
  // never touches — it only sweeps *pending* files (see `setupTempFileCleanup` in `server.ts`).
  const specsheet = await ctx.prisma.merchandisingSpecsheet.findUnique({
    where: { id: params.specsheetId },
    include: { _count: { select: { images: true } } },
  });

  if (!specsheet) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Specsheet non trovata' });
  }

  const isFirst = specsheet._count.images === 0;
  // Independent of each other — `ingestImageAsset` doesn't touch `merchandisingImage`,
  // and the count doesn't need the upload's result — so there's no reason to wait
  // on one before starting the other.
  const [result, existingCount] = await Promise.all([
    ingestImageAsset(ctx, { kind: 'specsheet-image', file: params.file }),
    ctx.prisma.merchandisingImage.count({ where: { specsheetId: params.specsheetId } }),
  ]);

  const image = await ctx.prisma.merchandisingImage.create({
    data: {
      specsheetId: params.specsheetId,
      key: result.key,
      isDefault: isFirst,
      order: existingCount,
      caption: params.caption ?? null,
    },
  });

  try {
    await logAudit(ctx, {
      action: 'SPECSHEET_IMAGE_UPLOADED',
      targetType: 'MerchandisingSpecsheet',
      targetId: params.specsheetId,
      result: 'SUCCESS',
      metadata: { filename: result.originalName, size: params.file.size, imageId: image.id },
    });
  } catch (auditError) {
    ctx.logger?.warn({ auditError }, 'Audit log failed for specsheet image upload');
  }

  return { id: image.id, publicUrl: result.publicUrl };
}
