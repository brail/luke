import { TRPCError } from '@trpc/server';
import { Readable } from 'stream';

import { streamToBuffer, validateMagicBytes, validateImageFile } from '../lib/imageUpload';
import { resolvePublicUrl } from '../lib/storageUrl';
import { logAudit } from '../lib/auditLog';
import { putObject, deleteObjectByKey } from '../storage';
import type { Context } from '../lib/trpc';

const IMAGE_CONFIG = {
  allowedMimes: ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'] as const,
  maxSizeBytes: 5 * 1024 * 1024,
  allowedExtensions: ['.png', '.jpg', '.jpeg', '.webp'] as const,
};

export async function uploadCollectionRowPicture(
  ctx: Context,
  params: {
    rowId: string;
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

  const row = await ctx.prisma.collectionLayoutRow.findUnique({ where: { id: params.rowId } });

  if (!row) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Riga non trovata' });
  }

  const fileObject = await putObject(ctx, {
    bucket: 'collection-row-pictures',
    originalName: sanitizedFilename,
    contentType: params.file.mimetype,
    size: params.file.size,
    stream: Readable.from(buffer),
  });

  await ctx.prisma.collectionLayoutRow.update({
    where: { id: params.rowId },
    data: { pictureKey: fileObject.key },
  });

  if (row.pictureKey) {
    setImmediate(async () => {
      try {
        await deleteObjectByKey(ctx, { bucket: 'collection-row-pictures', key: row.pictureKey! });
      } catch (err) {
        ctx.logger?.warn({ err }, 'Failed to cleanup old row picture');
      }
    });
  }

  try {
    await logAudit(ctx, {
      action: 'COLLECTION_ROW_PICTURE_UPLOADED',
      targetType: 'CollectionLayoutRow',
      targetId: params.rowId,
      result: 'SUCCESS',
      metadata: {
        filename: sanitizedFilename,
        size: params.file.size,
        contentType: params.file.mimetype,
        oldPictureKey: row.pictureKey,
      },
    });
  } catch (auditError) {
    ctx.logger?.warn({ auditError }, 'Audit log failed for row picture upload');
  }

  const publicUrl = await resolvePublicUrl(ctx.prisma, 'collection-row-pictures', fileObject.key);
  return { publicUrl, bucket: 'collection-row-pictures', key: fileObject.key };
}
