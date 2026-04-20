/**
 * Service per upload immagini MerchandisingSpecsheet
 * Gestisce validazioni, upload tramite storage service e inserimento in MerchandisingImage
 */

import { TRPCError } from '@trpc/server';
import path from 'path';
import { Readable } from 'stream';

import { getPublicUrl } from '@luke/core';

import { putObject } from '../storage';
import { getStorageUrlConfig } from '../lib/storageUrl';
import { logAudit } from '../lib/auditLog';
import type { Context } from '../lib/trpc';

const ALLOWED_MIMES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
const MAX_SIZE = 10 * 1024 * 1024; // 10MB
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
      message: 'File troppo grande. Max 10MB',
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
  const sanitizedFilename = validateFile(params.file);

  const buffer = await streamToBuffer(params.file.stream);

  if (!validateMagicBytes(buffer, params.file.mimetype)) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'File corrotto o tipo non valido',
    });
  }

  const specsheet = await ctx.prisma.merchandisingSpecsheet.findUnique({
    where: { id: params.specsheetId },
    include: { _count: { select: { images: true } } },
  });

  if (!specsheet) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Specsheet non trovata' });
  }

  const newStream = Readable.from(buffer);
  const fileObject = await putObject(ctx, {
    bucket: 'merchandising-specsheet-images',
    originalName: sanitizedFilename,
    contentType: params.file.mimetype,
    size: params.file.size,
    stream: newStream,
  });

  const urlConfig = await getStorageUrlConfig(ctx.prisma);
  const publicUrl = getPublicUrl(
    'merchandising-specsheet-images',
    fileObject.key,
    urlConfig
  );

  const isFirst = specsheet._count.images === 0;
  const existingCount = await ctx.prisma.merchandisingImage.count({
    where: { specsheetId: params.specsheetId },
  });

  const image = await ctx.prisma.merchandisingImage.create({
    data: {
      specsheetId: params.specsheetId,
      url: publicUrl,
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
      metadata: { filename: sanitizedFilename, size: params.file.size, imageId: image.id },
    });
  } catch (auditError) {
    ctx.logger?.warn({ auditError }, 'Audit log failed for specsheet image upload');
  }

  return { id: image.id, publicUrl };
}

export async function uploadTempSpecsheetImage(
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
): Promise<{ publicUrl: string; tempImageId: string }> {
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
    bucket: 'temp-merchandising-specsheet-images',
    originalName: `${params.tempId}/${sanitizedFilename}`,
    contentType: params.file.mimetype,
    size: params.file.size,
    stream: newStream,
  });

  const urlConfig = await getStorageUrlConfig(ctx.prisma);
  const publicUrl = getPublicUrl(
    'temp-merchandising-specsheet-images',
    fileObject.key,
    urlConfig
  );

  try {
    await logAudit(ctx, {
      action: 'SPECSHEET_TEMP_IMAGE_UPLOADED',
      targetType: 'TempFile',
      targetId: params.tempId,
      result: 'SUCCESS',
      metadata: { tempId: params.tempId, filename: sanitizedFilename, size: params.file.size },
    });
  } catch (auditError) {
    ctx.logger?.warn({ auditError }, 'Audit log failed for temp specsheet image upload');
  }

  return { publicUrl, tempImageId: params.tempId };
}
