/**
 * Service per upload logo Brand
 * Gestisce validazioni, upload tramite storage service e aggiornamento Brand.logoUrl
 */

import { TRPCError } from '@trpc/server';
import path from 'path';
import { Readable } from 'stream';

import { getPublicUrl, extractKeyFromUrl, type UrlConfig } from '@luke/core';

import { putObject, deleteObject, getStorageProvider } from '../storage';
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
 * Ottiene configurazione URL dal context
 */
async function getUrlConfig(ctx: Context): Promise<UrlConfig> {
  const { getConfig } = await import('../lib/configManager');

  const publicBaseUrl = await getConfig(
    ctx.prisma,
    'storage.local.publicBaseUrl',
    false
  );
  const enableProxyStr = await getConfig(
    ctx.prisma,
    'storage.local.enableProxy',
    false
  );
  const enableProxy = enableProxyStr ? enableProxyStr === 'true' : true; // default true

  return {
    publicBaseUrl: publicBaseUrl || undefined,
    enableProxy,
  };
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

/**
 * Upload logo temporaneo per brand in creazione
 * File viene salvato in bucket temp-brand-logos/{tempId}/
 */
export async function uploadTempBrandLogo(
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
): Promise<{ publicUrl: string; tempLogoId: string }> {
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

  // Converti stream in buffer per validazione magic bytes
  const buffer = await streamToBuffer(params.file.stream);

  // Validazione magic bytes per prevenire file corrotti/spoofed
  if (!validateMagicBytes(buffer, params.file.mimetype)) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'File corrotto o tipo non valido',
    });
  }

  // Ricrea stream dal buffer per upload
  const newStream = Readable.from(buffer);

  // Upload file temporaneo con path temp-brand-logos/{tempId}/{filename}
  const fileObject = await putObject(ctx, {
    bucket: 'temp-brand-logos',
    originalName: `${params.tempId}/${sanitizedFilename}`,
    contentType: params.file.mimetype,
    size: params.file.size,
    stream: newStream,
  });

  // Genera URL pubblico usando contratti
  const urlConfig = await getUrlConfig(ctx);
  const publicUrl = getPublicUrl('temp-brand-logos', fileObject.key, urlConfig);

  // Log audit per upload temporaneo
  try {
    await logAudit(ctx, {
      action: 'BRAND_TEMP_LOGO_UPLOADED',
      targetType: 'TempFile',
      targetId: params.tempId,
      result: 'SUCCESS',
      metadata: {
        tempId: params.tempId,
        filename: sanitizedFilename,
        originalFilename: params.file.filename,
        size: params.file.size,
        contentType: params.file.mimetype,
      },
    });
  } catch (auditError) {
    // Log audit error ma non fallire la response
    ctx.logger?.warn(
      { auditError },
      'Audit log failed for temp brand logo upload'
    );
  }

  return {
    publicUrl,
    tempLogoId: params.tempId,
  };
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

  // Converti stream in buffer per validazione magic bytes
  const buffer = await streamToBuffer(params.file.stream);

  // Validazione magic bytes per prevenire file corrotti/spoofed
  if (!validateMagicBytes(buffer, params.file.mimetype)) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'File corrotto o tipo non valido',
    });
  }

  // Ricrea stream dal buffer per upload
  const newStream = Readable.from(buffer);

  // Verifica Brand esiste prima dell'upload
  const brand = await ctx.prisma.brand.findUnique({
    where: { id: params.brandId },
  });

  if (!brand) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: 'Brand non trovato',
    });
  }

  // Upload nuovo logo tramite storage service con filename sanitizzato
  const fileObject = await putObject(ctx, {
    bucket: 'brand-logos',
    originalName: sanitizedFilename,
    contentType: params.file.mimetype,
    size: params.file.size,
    stream: newStream,
  });

  // Genera URL pubblico usando contratti
  const urlConfig = await getUrlConfig(ctx);
  const publicUrl = getPublicUrl('brand-logos', fileObject.key, urlConfig);

  // Aggiorna Brand.logoUrl con URL pubblico
  await ctx.prisma.brand.update({
    where: { id: params.brandId },
    data: { logoUrl: publicUrl },
  });

  // Cleanup vecchio logo (best-effort)
  if (brand.logoUrl) {
    setImmediate(async () => {
      try {
        const oldKey = extractKeyFromUrl(brand.logoUrl!);
        if (oldKey) {
          await deleteObject(ctx, oldKey);
        }
      } catch (err) {
        ctx.logger?.warn({ err }, 'Failed to cleanup old logo');
      }
    });
  }

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

  return {
    publicUrl,
    bucket: 'brand-logos',
    key: fileObject.key,
  };
}

/**
 * Sposta file temporaneo da temp-brand-logos a brand-logos
 * Utilizzato durante creazione brand con tempLogoId
 */
export async function moveTempLogoToBrand(
  ctx: Context,
  params: {
    tempLogoId: string;
    brandId: string;
  }
): Promise<{ url: string }> {
  // Recupera metadati file temporaneo
  const tempFile = await ctx.prisma.fileObject.findFirst({
    where: {
      bucket: 'temp-brand-logos',
      key: { startsWith: params.tempLogoId },
    },
  });

  if (!tempFile) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: 'File temporaneo non trovato',
    });
  }

  // Estrai filename dal key (rimuovi tempId/)
  const filename = tempFile.key.replace(`${params.tempLogoId}/`, '');

  // Nuovo key per brand-logos
  const newKey = `${params.brandId}/${filename}`;

  // Leggi file temporaneo
  const provider = await getStorageProvider(ctx.prisma);
  const { stream } = await provider.get({
    bucket: 'temp-brand-logos',
    key: tempFile.key,
  });

  // Upload file nel bucket brand-logos
  const newFileObject = await putObject(ctx, {
    bucket: 'brand-logos',
    originalName: newKey,
    contentType: tempFile.contentType,
    size: tempFile.size,
    stream,
  });

  // Genera URL pubblico usando contratti
  const urlConfig = await getUrlConfig(ctx);
  const publicUrl = getPublicUrl('brand-logos', newFileObject.key, urlConfig);

  // Aggiorna Brand.logoUrl con URL pubblico
  await ctx.prisma.brand.update({
    where: { id: params.brandId },
    data: { logoUrl: publicUrl },
  });

  // Cleanup file temporaneo (best-effort)
  setImmediate(async () => {
    try {
      await provider.delete({
        bucket: 'temp-brand-logos',
        key: tempFile.key,
      });

      // Cancella metadati file temporaneo
      await ctx.prisma.fileObject.delete({
        where: { id: tempFile.id },
      });
    } catch (err) {
      ctx.logger?.warn({ err }, 'Failed to cleanup temp logo file');
    }
  });

  // Log audit
  try {
    await logAudit(ctx, {
      action: 'BRAND_TEMP_LOGO_MOVED',
      targetType: 'Brand',
      targetId: params.brandId,
      result: 'SUCCESS',
      metadata: {
        tempLogoId: params.tempLogoId,
        tempFileKey: tempFile.key,
        newFileKey: newKey,
        filename,
      },
    });
  } catch (auditError) {
    ctx.logger?.warn({ auditError }, 'Audit log failed for temp logo move');
  }

  return { url: publicUrl };
}
