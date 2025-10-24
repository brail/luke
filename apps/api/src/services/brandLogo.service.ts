/**
 * Service per upload logo Brand
 * Gestisce validazioni, upload tramite storage service e aggiornamento Brand.logoUrl
 */

import { TRPCError } from '@trpc/server';
import { getConfig } from '../lib/configManager';
import { putObject } from '../storage';
import { logAudit } from '../lib/auditLog';
import type { Context } from '../lib/trpc';

const ALLOWED_MIMES = ['image/png', 'image/jpeg', 'image/webp'];
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

  // Costruisci URL pubblico
  const publicBaseUrl =
    (await getConfig(ctx.prisma, 'storage.local.publicBaseUrl', false)) ||
    'http://localhost:3001/uploads';
  const logoUrl = `${publicBaseUrl}/brand-logos/${fileObject.key}`;

  // Aggiorna Brand.logoUrl
  await ctx.prisma.brand.update({
    where: { id: params.brandId },
    data: { logoUrl },
  });

  // Audit log
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

  return { url: logoUrl };
}
