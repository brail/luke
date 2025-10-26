/**
 * Service per upload logo Brand
 * Gestisce validazioni, upload tramite storage service e aggiornamento Brand.logoUrl
 */

import { TRPCError } from '@trpc/server';
import path from 'path';
import { Readable } from 'stream';

import { putObject, deleteObject } from '../storage';
import { logAudit } from '../lib/auditLog';
import type { Context } from '../lib/trpc';

const ALLOWED_MIMES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
const MAX_SIZE = 2 * 1024 * 1024; // 2MB
const ALLOWED_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp'];

/**
 * Converte stream in buffer per validazione magic bytes
 */
async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

/**
 * Estrae key dal logoUrl per cleanup
 */
function extractKeyFromUrl(logoUrl: string): string {
  // logoUrl format: /api/uploads/brand-logos/{key}
  const parts = logoUrl.split('/');
  return parts[parts.length - 1];
}

/**
 * Valida magic bytes del file per prevenire file corrotti/spoofed
 */
function validateMagicBytes(buffer: Buffer, mimetype: string): boolean {
  const magicBytes = buffer.slice(0, 4).toString('hex');

  const validMagicBytes: Record<string, string[]> = {
    'image/png': ['89504e47'],
    'image/jpeg': ['ffd8ffe0', 'ffd8ffe1', 'ffd8ffe2'],
    'image/jpg': ['ffd8ffe0', 'ffd8ffe1', 'ffd8ffe2'],
    'image/webp': ['52494646'], // RIFF header
  };

  const expectedBytes = validMagicBytes[mimetype];
  if (!expectedBytes) {
    return false;
  }

  return expectedBytes.some(expected => magicBytes.startsWith(expected));
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
): Promise<{ url: string }> {
  // Validazioni MIME type
  if (!ALLOWED_MIMES.includes(params.file.mimetype)) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `Tipo file non supportato. Usa: ${ALLOWED_MIMES.join(', ')}`,
    });
  }

  // Validazione dimensione file
  if (params.file.size > MAX_SIZE) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `File troppo grande. Max 2MB`,
    });
  }

  // Sanitizzazione filename per prevenire path traversal
  const sanitizedFilename = path
    .basename(params.file.filename)
    .replace(/[^a-zA-Z0-9._-]/g, '_');

  // Validazione estensione file (oltre MIME type)
  const ext = path.extname(sanitizedFilename).toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `Estensione file non valida. Usa: ${ALLOWED_EXTENSIONS.join(', ')}`,
    });
  }

  // Verifica Brand esiste
  const brand = await ctx.prisma.brand.findUnique({
    where: { id: params.brandId },
  });

  if (!brand) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: 'Brand non trovato',
    });
  }

  // Converti stream in buffer per validazione magic bytes
  const buffer = await streamToBuffer(params.file.stream);

  // Validazione magic bytes per prevenire file corrotti/spoofed
  if (!validateMagicBytes(buffer, params.file.mimetype)) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'File corrotto o tipo non valido',
    });
  }

  // Cleanup logo precedente se esiste
  if (brand.logoUrl) {
    try {
      const oldKey = extractKeyFromUrl(brand.logoUrl);
      await deleteObject(ctx, oldKey);
    } catch (err) {
      ctx.logger?.warn({ err }, 'Failed to delete old logo');
    }
  }

  // Ricrea stream dal buffer per upload
  const newStream = Readable.from(buffer);

  // Upload file tramite storage service con filename sanitizzato
  const fileObject = await putObject(ctx, {
    bucket: 'brand-logos',
    originalName: sanitizedFilename,
    contentType: params.file.mimetype,
    size: params.file.size,
    stream: newStream,
  });

  // Costruisci URL relativo per il frontend (usa il proxy)
  const logoUrl = `/api/uploads/brand-logos/${fileObject.key}`;

  // Aggiorna Brand.logoUrl
  await ctx.prisma.brand.update({
    where: { id: params.brandId },
    data: { logoUrl },
  });

  // Audit log in try/catch per non fallire la response
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
        oldLogoUrl: brand.logoUrl,
      },
    });
  } catch (auditError) {
    // Log audit error ma non fallire la response
    ctx.logger?.warn({ auditError }, 'Audit log failed for brand logo upload');
  }

  return { url: logoUrl };
}
