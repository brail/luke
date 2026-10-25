/**
 * Confirmation of a *pending* upload and linking it to an entity.
 *
 * An uploaded file is born with `confirmedAt: null`: it exists in storage but
 * doesn't belong to anything yet, and the pending-file reaper in `server.ts`
 * (every 30 minutes, anything pending for over an hour) sweeps it up if it
 * stays that way. Linking it to a brand, a collection row, a specsheet image or
 * the company profile means marking it confirmed and writing its key onto the entity.
 *
 * The predicate used to be copied four times — `brand.create`, `brand.update`,
 * `collectionLayout.rows.create`, `collectionLayout.rows.update` — character for
 * character. This module is that, once.
 *
 * ## Without a policy, on purpose
 *
 * It unifies the **predicate**, not the **reaction**: it returns the key or
 * `null`, and what to do with that is up to the caller. Today every caller
 * refuses an unusable id — the brand, the company profile and the collection
 * rows with BAD_REQUEST (a save that silently loses the file is data loss with
 * a success toast), the specsheet upload, which has just stored the file, with
 * an internal error — but the wording of that refusal stays the caller's.
 *
 * Lives in `lib/` and not in `services/` because it's a transaction primitive
 * with no domain knowledge.
 */

import type { StorageBucket } from '@luke/core';
import type { Prisma, PrismaClient } from '@luke/db';

/** Accepts either the normal client or one from an interactive transaction. */
type PrismaLike = PrismaClient | Prisma.TransactionClient;

/**
 * Confirms a pending `FileObject` and returns its storage key.
 *
 * The three checks are conjunctive and none is redundant:
 * - `confirmedAt === null` — must still be pending, i.e. not already linked
 *   to another entity. A confirmed file already has an owner.
 * - `createdBy === userId` — only whoever uploaded it can link it.
 * - `bucket` — prevents passing off the id of a file from a different domain
 *   (a brand logo posing as a company logo, for instance).
 *
 * Must be called **inside** the same transaction that writes the key onto the
 * entity: confirming and linking must succeed or fail together.
 *
 * One conditional write, not a read then a write, so a file is claimed — and its key linked — at
 * most once, also when two saves confirm it at the same time: the second waits on the first's row
 * lock and, once it commits, finds no pending row to claim.
 *
 * @returns The storage key to write onto the entity, or `null` if the file
 *   doesn't exist, isn't pending, isn't yours, or is in the wrong bucket. The
 *   caller decides whether that's an error or a no-op.
 */
export async function confirmPendingFile(
  tx: PrismaLike,
  params: { fileObjectId: string; bucket: StorageBucket; userId: string }
): Promise<string | null> {
  const confirmedAt = new Date();
  const [claimed] = await tx.fileObject.updateManyAndReturn({
    where: { id: params.fileObjectId, confirmedAt: null, createdBy: params.userId, bucket: params.bucket },
    data: { confirmedAt },
    select: { key: true },
  });
  if (!claimed) return null;

  // Derivatives mirror the master's pending state and are confirmed alongside it —
  // they're excluded from the reaper's own query (`parentId: null`), so this isn't
  // required for their survival, but it keeps `confirmedAt` meaningful across the
  // whole tree instead of derivative rows staying "pending" forever.
  await tx.fileObject.updateMany({
    where: { parentId: params.fileObjectId, confirmedAt: null },
    data: { confirmedAt },
  });

  return claimed.key;
}
