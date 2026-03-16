/**
 * Service per upload foto CollectionLayoutRow
 * Gestisce validazioni, upload tramite storage service e aggiornamento CollectionLayoutRow.pictureUrl
 */

import { TRPCError } from '@trpc/server';
import path from 'path';
import { Readable } from 'stream';

import {
  getPublicUrl,
  extractKeyFromUrl,
  extractBucketFromUrl,
} from '@luke/core';

import { putObject, deleteObjectByKey } from '../storage';
import { getStorageUrlConfig } from '../lib/storageUrl';
import { logAudit } from '../lib/auditLog';
import type { Context } from '../lib/trpc';

const ALLOWED_MIMES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
const MAX_SIZE = 5 * 1024 * 1024; // 5MB (foto più grandi dei loghi)
const ALLOWED_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp'];

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

function validateMagicBytes(buffer: Buffer, mimetype: string): boolean {
  const magicBytes = buffer.slice(0, 4).toString('hex');

  const validMagicBytes: Record<string, string[]> = {
    'image/png': ['89504e47'],
    'image/jpeg': ['ffd8ffe0', 'ffd8ffe1', 'ffd8ffe2'],
    'image/jpg': ['ffd8ffe0', 'ffd8ffe1', 'ffd8ffe2'],
    'image/webp': ['52494646'],
  };

  const expectedBytes = validMagicBytes[mimetype];
  if (!expectedBytes) return false;
  return expectedBytes.some(expected => magicBytes.startsWith(expected));
}

function validateFile(file: { mimetype: string; size: number; filename: string }) {
  if (!ALLOWED_MIMES.includes(file.mimetype)) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `Tipo file non supportato. Usa: ${ALLOWED_MIMES.join(', ')}`,
    });
  }

  if (file.size > MAX_SIZE) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'File troppo grande. Max 5MB',
    });
  }

  const sanitizedFilename = path
    .basename(file.filename)
    .replace(/[^a-zA-Z0-9._-]/g, '_');
  const ext = path.extname(sanitizedFilename).toLowerCase();

  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `Estensione file non valida. Usa: ${ALLOWED_EXTENSIONS.join(', ')}`,
    });
  }

  return sanitizedFilename;
}

export async function uploadTempCollectionRowPicture(
  ctx: Context,
  params: {
    tempId: string;
    file: {
      filename: string;
      mimetype: string;
      stream: NodeJS.ReadableStream;
      size: number;
    };
  }
): Promise<{ publicUrl: string; tempPictureId: string }> {
  const sanitizedFilename = validateFile(params.file);

  const buffer = await streamToBuffer(params.file.stream);

  if (!validateMagicBytes(buffer, params.file.mimetype)) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'File corrotto o tipo non valido',
    });
  }

  const newStream = Readable.from(buffer);

  const fileObject = await putObject(ctx, {
    bucket: 'temp-collection-row-pictures',
    originalName: `${params.tempId}/${sanitizedFilename}`,
    contentType: params.file.mimetype,
    size: params.file.size,
    stream: newStream,
  });

  const urlConfig = await getStorageUrlConfig(ctx.prisma);
  const publicUrl = getPublicUrl(
    'temp-collection-row-pictures',
    fileObject.key,
    urlConfig
  );

  try {
    await logAudit(ctx, {
      action: 'COLLECTION_ROW_TEMP_PICTURE_UPLOADED',
      targetType: 'TempFile',
      targetId: params.tempId,
      result: 'SUCCESS',
      metadata: {
        tempId: params.tempId,
        filename: sanitizedFilename,
        size: params.file.size,
        contentType: params.file.mimetype,
      },
    });
  } catch (auditError) {
    ctx.logger?.warn({ auditError }, 'Audit log failed for temp picture upload');
  }

  return { publicUrl, tempPictureId: params.tempId };
}

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
  const sanitizedFilename = validateFile(params.file);

  const buffer = await streamToBuffer(params.file.stream);

  if (!validateMagicBytes(buffer, params.file.mimetype)) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'File corrotto o tipo non valido',
    });
  }

  const newStream = Readable.from(buffer);

  const row = await ctx.prisma.collectionLayoutRow.findUnique({
    where: { id: params.rowId },
  });

  if (!row) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: 'Riga non trovata',
    });
  }

  const fileObject = await putObject(ctx, {
    bucket: 'collection-row-pictures',
    originalName: sanitizedFilename,
    contentType: params.file.mimetype,
    size: params.file.size,
    stream: newStream,
  });

  const urlConfig = await getStorageUrlConfig(ctx.prisma);
  const publicUrl = getPublicUrl(
    'collection-row-pictures',
    fileObject.key,
    urlConfig
  );

  await ctx.prisma.collectionLayoutRow.update({
    where: { id: params.rowId },
    data: { pictureUrl: publicUrl },
  });

  // Cleanup vecchia foto (best-effort)
  if (row.pictureUrl) {
    setImmediate(async () => {
      try {
        const oldKey = extractKeyFromUrl(row.pictureUrl!);
        const oldBucket = extractBucketFromUrl(row.pictureUrl!);
        if (oldKey && oldBucket) {
          await deleteObjectByKey(ctx, { bucket: oldBucket, key: oldKey });
        }
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
        oldPictureUrl: row.pictureUrl,
      },
    });
  } catch (auditError) {
    ctx.logger?.warn({ auditError }, 'Audit log failed for row picture upload');
  }

  return {
    publicUrl,
    bucket: 'collection-row-pictures',
    key: fileObject.key,
  };
}
