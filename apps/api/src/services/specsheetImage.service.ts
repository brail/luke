import { TRPCError } from '@trpc/server';
import { Readable } from 'stream';

import { streamToBuffer, validateMagicBytes, validateImageFile } from '../lib/imageUpload';
import { resolvePublicUrl } from '../lib/storageUrl';
import { logAudit } from '../lib/auditLog';
import { putObject } from '../storage';
import type { Context } from '../lib/trpc';

const IMAGE_CONFIG = {
  allowedMimes: ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'] as const,
  maxSizeBytes: 10 * 1024 * 1024,
  allowedExtensions: ['.png', '.jpg', '.jpeg', '.webp'] as const,
};

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
  const sanitizedFilename = validateImageFile(params.file, IMAGE_CONFIG);

  const buffer = await streamToBuffer(params.file.stream);

  if (!validateMagicBytes(buffer, params.file.mimetype)) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'File corrotto o tipo non valido' });
  }

  const specsheet = await ctx.prisma.merchandisingSpecsheet.findUnique({
    where: { id: params.specsheetId },
    include: { _count: { select: { images: true } } },
  });

  if (!specsheet) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Specsheet non trovata' });
  }

  const fileObject = await putObject(ctx, {
    bucket: 'merchandising-specsheet-images',
    originalName: sanitizedFilename,
    contentType: params.file.mimetype,
    size: params.file.size,
    stream: Readable.from(buffer),
  });

  const isFirst = specsheet._count.images === 0;
  const existingCount = await ctx.prisma.merchandisingImage.count({
    where: { specsheetId: params.specsheetId },
  });

  const image = await ctx.prisma.merchandisingImage.create({
    data: {
      specsheetId: params.specsheetId,
      key: fileObject.key,
      isDefault: isFirst,
      order: existingCount,
      caption: params.caption ?? null,
    },
  });

  const publicUrl = await resolvePublicUrl(ctx.prisma, 'merchandising-specsheet-images', fileObject.key);

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
