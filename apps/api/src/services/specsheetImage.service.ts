import { TRPCError } from '@trpc/server';

import { Prisma } from '@luke/db';

import { logAudit } from '../lib/auditLog';
import { isForeignKeyViolation } from '../lib/error';
import { confirmPendingFile } from '../lib/pendingFile';

import { ingestImageAsset } from './asset.service';
import { resolveMerchImageBrandAccess, resolveMerchSpecsheetBrandAccess } from './brandScope.service';

import type { Context } from '../lib/trpc';

/**
 * Serializes every writer of one specsheet's images — upload, delete, set-default — so "exactly one
 * default while the gallery holds images" survives concurrent requests: each decides on what it
 * re-reads after taking the lock. Scoped to the transaction, released on commit or rollback.
 * Deleting a plan row or specsheet cascades over its images without taking it; a writer that then
 * finds its specsheet or image gone answers NOT_FOUND. Raw SQL because the Prisma ORM has no
 * advisory locks — the `acquireLastAdminLock` pattern.
 */
async function lockSpecsheetImages(tx: Prisma.TransactionClient, specsheetId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`merchandising-specsheet-images:${specsheetId}`}))`;
}

const imageNotFound = () => new TRPCError({ code: 'NOT_FOUND', message: 'Immagine non trovata' });
const specsheetNotFound = () => new TRPCError({ code: 'NOT_FOUND', message: 'Specsheet non trovata' });

/**
 * Validates and stores an image file for a merchandising specsheet.
 * Validates MIME type, file size, extension, and magic bytes before storage.
 * The first image of an empty gallery becomes the default; later ones are appended after the
 * highest order.
 *
 * The file is stored pending, outside the transaction (no lock held across storage I/O), and is
 * confirmed in the same locked transaction that creates the image row: if that transaction fails,
 * the file stays pending and the pending-file reaper removes it.
 *
 * @returns The new image record ID and its resolved public URL.
 * @throws {TRPCError} BAD_REQUEST if the file is corrupted or the type is invalid.
 * @throws {TRPCError} NOT_FOUND if the specsheet does not exist, or is deleted meanwhile.
 * @throws {TRPCError} FORBIDDEN if its plan's brand is outside the user's scope.
 */
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
  // Existence and brand scope are checked before uploading, so a refused request stores nothing.
  await resolveMerchSpecsheetBrandAccess(ctx, params.specsheetId);
  const userId = ctx.session?.user.id;
  if (!userId) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Devi essere autenticato' });
  }

  const result = await ingestImageAsset(ctx, { kind: 'specsheet-image', file: params.file, pending: true });

  const image = await ctx.prisma.$transaction(async tx => {
    await lockSpecsheetImages(tx, params.specsheetId);

    const specsheet = await tx.merchandisingSpecsheet.findUnique({
      where: { id: params.specsheetId },
      select: { id: true },
    });
    if (!specsheet) throw specsheetNotFound();

    const gallery = await tx.merchandisingImage.aggregate({
      where: { specsheetId: params.specsheetId },
      _count: { _all: true },
      _max: { order: true },
    });

    const key = await confirmPendingFile(tx, {
      fileObjectId: result.fileObjectId,
      bucket: result.bucket,
      userId,
    });
    if (!key) {
      // Just stored by this request as pending: only the reaper (after an hour) could have taken it.
      throw new Error(`Uploaded specsheet image ${result.fileObjectId} could not be confirmed`);
    }

    return tx.merchandisingImage.create({
      data: {
        specsheetId: params.specsheetId,
        key,
        isDefault: gallery._count._all === 0,
        order: (gallery._max.order ?? -1) + 1,
        caption: params.caption ?? null,
      },
    });
  }).catch((err: unknown) => {
    // A cascade from deleting the plan row or the specsheet does not take the lock, so the
    // specsheet can still go between the re-read and the insert; the whole transaction, the file's
    // confirmation included, has rolled back.
    if (isForeignKeyViolation(err, 'merchandising_images_specsheetId_fkey')) throw specsheetNotFound();
    throw err;
  });

  try {
    await logAudit(ctx, {
      action: 'SPECSHEET_IMAGE_UPLOADED',
      targetType: 'MerchandisingSpecsheet',
      targetId: params.specsheetId,
      result: 'SUCCESS',
      metadata: { filename: result.originalName, size: params.file.size, imageId: image.id },
    });
  } catch (auditError) {
    ctx.logger?.warn({ auditError }, 'Audit log failed for specsheet image upload');
  }

  return { id: image.id, publicUrl: result.publicUrl };
}

/**
 * Deletes an image. If it was the default — as re-read under the lock, not as first seen — the
 * next image by order is promoted.
 *
 * @returns The specsheet the image belonged to.
 * @throws {TRPCError} NOT_FOUND if the image does not exist, or is deleted meanwhile.
 * @throws {TRPCError} FORBIDDEN if its plan's brand is outside the user's scope.
 */
export async function deleteSpecsheetImage(ctx: Context, imageId: string): Promise<{ specsheetId: string }> {
  const { specsheetId } = await resolveMerchImageBrandAccess(ctx, imageId);

  await ctx.prisma.$transaction(async tx => {
    await lockSpecsheetImages(tx, specsheetId);

    // One statement re-reads and deletes: the row it returns is the image as it was under the lock.
    let deleted: { isDefault: boolean };
    try {
      deleted = await tx.merchandisingImage.delete({ where: { id: imageId }, select: { isDefault: true } });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') throw imageNotFound();
      throw err;
    }

    if (deleted.isDefault) {
      const next = await tx.merchandisingImage.findFirst({ where: { specsheetId }, orderBy: { order: 'asc' } });
      if (next) {
        await tx.merchandisingImage.updateMany({ where: { id: next.id }, data: { isDefault: true } });
      }
    }
  });

  return { specsheetId };
}

/**
 * Makes an image the specsheet's default, clearing the flag on every other one.
 *
 * @returns The specsheet the image belongs to.
 * @throws {TRPCError} NOT_FOUND if the image does not exist, or is deleted meanwhile.
 * @throws {TRPCError} FORBIDDEN if its plan's brand is outside the user's scope.
 */
export async function setDefaultSpecsheetImage(ctx: Context, imageId: string): Promise<{ specsheetId: string }> {
  const { specsheetId } = await resolveMerchImageBrandAccess(ctx, imageId);

  await ctx.prisma.$transaction(async tx => {
    await lockSpecsheetImages(tx, specsheetId);

    await tx.merchandisingImage.updateMany({ where: { specsheetId }, data: { isDefault: false } });
    const { count } = await tx.merchandisingImage.updateMany({ where: { id: imageId }, data: { isDefault: true } });
    // The image is gone: throwing rolls the reset back too, so the previous default is kept.
    if (count === 0) throw imageNotFound();
  });

  return { specsheetId };
}
