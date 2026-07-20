import { Readable } from 'stream';

import { TRPCError } from '@trpc/server';

import { logAudit } from '../lib/auditLog.js';
import { validateImageFile, streamToBuffer, validateMagicBytes } from '../lib/imageUpload.js';
import { resolvePublicUrl } from '../lib/storageUrl.js';
import { putObject } from '../storage/index.js';

import type { Context } from '../lib/trpc.js';

const IMAGE_CONFIG = {
  allowedMimes: ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'] as const,
  maxSizeBytes: 2 * 1024 * 1024,
  allowedExtensions: ['.png', '.jpg', '.jpeg', '.webp'] as const,
};

/**
 * Uploads a company logo to the company-assets bucket.
 *
 * @returns Public URL, bucket name, and storage key of the uploaded logo.
 * @throws {TRPCError} BAD_REQUEST if the file type or magic bytes are invalid.
 */
export async function uploadCompanyLogo(
  ctx: Context,
  params: {
    file: {
      filename: string;
      mimetype: string;
      stream: NodeJS.ReadableStream;
      size: number;
    };
  }
): Promise<{ publicUrl: string; bucket: string; key: string }> {
  const sanitizedFilename = validateImageFile(params.file, IMAGE_CONFIG);

  const buffer = await streamToBuffer(params.file.stream);

  if (!validateMagicBytes(buffer, params.file.mimetype)) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'File corrotto o tipo non valido' });
  }

  const fileObject = await putObject(ctx, {
    bucket: 'company-assets',
    originalName: sanitizedFilename,
    contentType: params.file.mimetype,
    size: params.file.size,
    stream: Readable.from(buffer),
  });

  try {
    await logAudit(ctx, {
      action: 'COMPANY_LOGO_UPLOADED',
      targetType: 'CompanyProfile',
      targetId: 'singleton',
      result: 'SUCCESS',
      metadata: { filename: sanitizedFilename, size: params.file.size, contentType: params.file.mimetype },
    });
  } catch (auditError) {
    ctx.logger?.warn({ auditError }, 'Audit log failed for company logo upload');
  }

  const publicUrl = await resolvePublicUrl(ctx.prisma, 'company-assets', fileObject.key);
  return { publicUrl, bucket: 'company-assets', key: fileObject.key };
}
