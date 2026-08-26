import { TRPCError } from '@trpc/server';

import { logAudit } from '../lib/auditLog';

import { ingestImageAsset } from './asset.service';

import type { Context } from '../lib/trpc';

type FileParams = {
  filename: string;
  mimetype: string;
  stream: NodeJS.ReadableStream;
  size: number;
};

// Upload for an existing row — validates row exists, then stores file (pending).
// Does NOT update the DB: the pictureKey is confirmed when the form saves via tRPC.
/**
 * Uploads a picture for an existing collection row as a pending file. The pictureKey
 * is persisted only when the row is saved via the tRPC update mutation.
 *
 * @throws {TRPCError} NOT_FOUND if the row does not exist.
 * @throws {TRPCError} BAD_REQUEST if the file type or magic bytes are invalid.
 */
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

  const result = await ingestImageAsset(ctx, {
    kind: 'collection-row-picture',
    file: params.file,
    pending: true,
  });

  try {
    await logAudit(ctx, {
      action: 'COLLECTION_ROW_PICTURE_UPLOADED',
      targetType: 'CollectionLayoutRow',
      targetId: params.rowId,
      result: 'SUCCESS',
      metadata: {
        filename: result.originalName,
        size: params.file.size,
        contentType: params.file.mimetype,
      },
    });
  } catch (auditError) {
    ctx.logger?.warn({ auditError }, 'Audit log failed for row picture upload');
  }

  return {
    publicUrl: result.publicUrl,
    bucket: result.bucket,
    key: result.key,
    fileObjectId: result.fileObjectId,
  };
}

// Upload without a row — used in create mode before the row exists.
// Returns fileObjectId so the frontend can pass it on form submit to confirm.
/**
 * Uploads a picture before the row exists (create-mode). The caller passes the returned
 * fileObjectId in the row creation payload to confirm the upload.
 *
 * @throws {TRPCError} BAD_REQUEST if the file type or magic bytes are invalid.
 */
export async function uploadTempCollectionRowPicture(
  ctx: Context,
  params: { file: FileParams }
): Promise<{ publicUrl: string; fileObjectId: string }> {
  const result = await ingestImageAsset(ctx, {
    kind: 'collection-row-picture',
    file: params.file,
    pending: true,
  });
  return { publicUrl: result.publicUrl, fileObjectId: result.fileObjectId };
}
