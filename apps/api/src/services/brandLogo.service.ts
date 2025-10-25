/**
 * Service per upload logo Brand
 * Gestisce validazioni, upload tramite storage service e aggiornamento Brand.logoUrl
 */

import { TRPCError } from '@trpc/server';
import { putObject } from '../storage';
import { logAudit } from '../lib/auditLog';
import type { Context } from '../lib/trpc';

const ALLOWED_MIMES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
const MAX_SIZE = 2 * 1024 * 1024; // 2MB

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
  // Validazioni
  if (!ALLOWED_MIMES.includes(params.file.mimetype)) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `Tipo file non supportato. Usa: ${ALLOWED_MIMES.join(', ')}`,
    });
  }

  if (params.file.size > MAX_SIZE) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `File troppo grande. Max 2MB`,
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

  // Upload file tramite storage service
  const fileObject = await putObject(ctx, {
    bucket: 'brand-logos',
    originalName: params.file.filename,
    contentType: params.file.mimetype,
    size: params.file.size,
    stream: params.file.stream,
  });

  // Costruisci URL relativo per il frontend (usa il proxy)
  const relativeUrl = `/api/uploads/brand-logos/${fileObject.key}`;
  
  // Per il database, salviamo l'URL relativo
  const logoUrl = relativeUrl;

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
        filename: params.file.filename,
        size: params.file.size,
        contentType: params.file.mimetype,
      },
    });
  } catch (auditError) {
    // Log audit error ma non fallire la response
    ctx.logger?.warn({ auditError }, 'Audit log failed for brand logo upload');
  }

  return { url: relativeUrl };
}
