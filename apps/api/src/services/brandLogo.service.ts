/**
 * Service per upload logo Brand
 * Gestisce validazioni, upload tramite storage service e aggiornamento Brand.logoUrl
 */

import { TRPCError } from '@trpc/server';
import { getConfig } from '../lib/configManager';
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
  console.log('🚀 uploadBrandLogo started:', {
    brandId: params.brandId,
    filename: params.file.filename,
    mimetype: params.file.mimetype,
    size: params.file.size,
  });

  // Validazioni
  if (!ALLOWED_MIMES.includes(params.file.mimetype)) {
    console.log('❌ MIME type not allowed:', params.file.mimetype);
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `Tipo file non supportato. Usa: ${ALLOWED_MIMES.join(', ')}`,
    });
  }

  if (params.file.size > MAX_SIZE) {
    console.log('❌ File too large:', params.file.size, 'max:', MAX_SIZE);
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `File troppo grande. Max 2MB`,
    });
  }

  // Verifica Brand esiste
  console.log('🔍 Checking brand exists:', params.brandId);
  const brand = await ctx.prisma.brand.findUnique({
    where: { id: params.brandId },
  });

  if (!brand) {
    console.log('❌ Brand not found:', params.brandId);
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: 'Brand non trovato',
    });
  }
  console.log('✅ Brand found:', brand.name);

  // Upload file tramite storage service
  console.log('📤 Calling putObject...');
  const fileObject = await putObject(ctx, {
    bucket: 'brand-logos',
    originalName: params.file.filename,
    contentType: params.file.mimetype,
    size: params.file.size,
    stream: params.file.stream,
  });
  console.log('✅ putObject success:', fileObject.key);

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

  return { url: logoUrl };
}
