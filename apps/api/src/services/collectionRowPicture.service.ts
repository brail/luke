import { TRPCError } from '@trpc/server';
import { Readable } from 'stream';

import { streamToBuffer, validateMagicBytes, validateImageFile } from '../lib/imageUpload';
import { resolvePublicUrl } from '../lib/storageUrl';
import { logAudit } from '../lib/auditLog';
import { putObject } from '../storage';
import type { Context } from '../lib/trpc';

const IMAGE_CONFIG = {
  allowedMimes: ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'] as const,
  maxSizeBytes: 5 * 1024 * 1024,
  allowedExtensions: ['.png', '.jpg', '.jpeg', '.webp'] as const,
};

type FileParams = {
  filename: string;
  mimetype: string;
  stream: NodeJS.ReadableStream;
  size: number;
};

// Upload file to storage without any DB update — key must be saved via form submit.
async function storeCollectionRowPicture(
  ctx: Context,
  file: FileParams,
  pending = false
): Promise<{ publicUrl: string; bucket: string; key: string; fileObjectId: string }> {
  const sanitizedFilename = validateImageFile(file, IMAGE_CONFIG);
  const buffer = await streamToBuffer(file.stream);

  if (!validateMagicBytes(buffer, file.mimetype)) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'File corrotto o tipo non valido' });
  }

  const fileObject = await putObject(ctx, {
    bucket: 'collection-row-pictures',
    originalName: sanitizedFilename,
    contentType: file.mimetype,
    size: file.size,
    stream: Readable.from(buffer),
    ...(pending && { pending: true }),
  });

  const publicUrl = await resolvePublicUrl(ctx.prisma, 'collection-row-pictures', fileObject.key);
  return { publicUrl, bucket: 'collection-row-pictures', key: fileObject.key, fileObjectId: fileObject.id };
}

// Upload for an existing row — validates row exists, then stores file (pending).
// Does NOT update the DB: the pictureKey is confirmed when the form saves via tRPC.
export async function uploadCollectionRowPicture(
  ctx: Context,
  params: {
    rowId: string;
    file: FileParams;
  }
): Promise<{ publicUrl: string; bucket: string; key: string; fileObjectId: string }> {
  const row = await ctx.prisma.collectionLayoutRow.findUnique({ where: { id: params.rowId } });

  if (!row) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Riga non trovata' });
  }

  const result = await storeCollectionRowPicture(ctx, params.file, true);

  try {
    await logAudit(ctx, {
      action: 'COLLECTION_ROW_PICTURE_UPLOADED',
      targetType: 'CollectionLayoutRow',
      targetId: params.rowId,
      result: 'SUCCESS',
      metadata: {
        filename: params.file.filename,
        size: params.file.size,
        contentType: params.file.mimetype,
      },
    });
  } catch (auditError) {
    ctx.logger?.warn({ auditError }, 'Audit log failed for row picture upload');
  }

  return result;
}

// Upload without a row — used in create mode before the row exists.
// Returns fileObjectId so the frontend can pass it on form submit to confirm.
export async function uploadTempCollectionRowPicture(
  ctx: Context,
  params: { file: FileParams }
): Promise<{ publicUrl: string; fileObjectId: string }> {
  const result = await storeCollectionRowPicture(ctx, params.file, true);
  return { publicUrl: result.publicUrl, fileObjectId: result.fileObjectId };
}
