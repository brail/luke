import { logAudit } from '../lib/auditLog.js';

import { ingestImageAsset } from './asset.service.js';

import type { Context } from '../lib/trpc.js';

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
): Promise<{ publicUrl: string; bucket: string; key: string; fileObjectId: string }> {
  const result = await ingestImageAsset(ctx, {
    kind: 'company-asset',
    file: params.file,
    // Pending: the file exists, but doesn't belong to the profile yet. It gets linked
    // by `company.profile.update` passing the `fileObjectId`, never the key.
    pending: true,
  });

  try {
    await logAudit(ctx, {
      action: 'COMPANY_LOGO_UPLOADED',
      targetType: 'CompanyProfile',
      targetId: 'singleton',
      result: 'SUCCESS',
      metadata: { filename: result.originalName, size: params.file.size, contentType: params.file.mimetype },
    });
  } catch (auditError) {
    ctx.logger?.warn({ auditError }, 'Audit log failed for company logo upload');
  }

  // `fileObjectId` is the field that matters: `key` is kept only because `publicUrl`
  // exposes it anyway, but nothing downstream should rely on it.
  return {
    publicUrl: result.publicUrl,
    bucket: result.bucket,
    key: result.key,
    fileObjectId: result.fileObjectId,
  };
}
