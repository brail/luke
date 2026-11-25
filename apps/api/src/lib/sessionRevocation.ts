/**
 * The one way to end a user's sessions (ADR-052). Every `tokenVersion` increment goes through
 * `revokingTransaction` (`.semgrep/rules/session-revocation-helper.yml`), which records whose
 * sessions the transaction ends and, only once it has committed, makes it take effect at once:
 * the cached version is dropped (`tokenVersionCache.ts`), each open tab is told (`session-revoked`)
 * and its stream is ended. A rolled-back transaction ends nothing, so it publishes nothing.
 *
 * The push reaches the streams of this process only (the SSE store is per process, ADR-011); a
 * tab without a stream learns at its next call or heartbeat, which the API refuses.
 */

import type { Prisma, PrismaClient } from '@luke/db';

import { sseStore } from './sseStore';
import { invalidateTokenVersionCache } from './tokenVersionCache';

/** What a revoking transaction can end, handed to its callback with the transaction client. */
export interface SessionRevocation {
  /** Ends every session of `userId`: the value of `tokenVersion` in that user's update. */
  user(userId: string): { increment: 1 };
  /**
   * Records that another write of the transaction ends the sessions of `userId` with no increment
   * (a deactivation, a deletion).
   */
  ended(userId: string): void;
  /** Ends the sessions of every user matching `where`, in one statement; returns how many. */
  where(where: Prisma.UserWhereInput): Promise<number>;
}

/**
 * Runs `fn` in a transaction with a `SessionRevocation`; after the commit, ends at once the
 * sessions it recorded. Returns what `fn` returns; an error of `fn` rolls back and publishes nothing.
 */
export async function revokingTransaction<T>(
  prisma: PrismaClient,
  fn: (tx: Prisma.TransactionClient, revoke: SessionRevocation) => Promise<T>
): Promise<T> {
  const ended = new Set<string>();
  // A `revoke` kept past the commit would record what nobody is told: refused instead.
  let open = true;
  const record = (userId: string) => {
    if (!open) throw new Error('A session revocation was recorded after its transaction ended');
    ended.add(userId);
  };
  const result = await prisma.$transaction(tx =>
    fn(tx, {
      user: userId => {
        record(userId);
        return { increment: 1 };
      },
      ended: record,
      where: async where => {
        // The ids come from the update itself, so they are exactly the users it revoked.
        const revoked = await tx.user.updateManyAndReturn({
          where,
          data: { tokenVersion: { increment: 1 } },
          select: { id: true },
        });
        for (const { id } of revoked) record(id);
        return revoked.length;
      },
    })
  ).finally(() => {
    open = false;
  });
  for (const userId of ended) {
    invalidateTokenVersionCache(userId);
    // Neither throws: a write to a closing stream and an `end` that fails are caught per stream.
    sseStore.pushToUser(userId, { type: 'session-revoked' });
    sseStore.endUser(userId);
  }
  return result;
}
