/**
 * Generic paging/chunking utilities for age-based retention sweeps, shared by
 * `retentionScheduler.ts` across audit-log and notification cleanup. No dependency on any
 * specific Prisma model — the caller supplies the filtered query and the delete call; this
 * module only bounds how much work a single tick can do.
 *
 * Two concerns kept separate on purpose:
 * - `collectIdsOlderThan` pages through a caller-filtered query up to a hard cap, so a
 *   multi-million-row backlog can't make one tick run unbounded — the remainder is picked up
 *   on the next tick.
 * - `deleteIdsInBatches` chunks a (possibly large) id array into sequential `deleteMany` calls,
 *   so a single `WHERE id IN (...)` never spans an unbounded number of rows.
 */

const PAGE_SIZE = 1000;

/** Also reused by `auditLogArchive.ts` as its row-fetch chunk size — one shared batch size for the whole sweep pipeline instead of a second, arbitrary one. */
export const BATCH_SIZE = 1000;

/**
 * Pages through `findPage(skip, take)` — a caller-provided, already-filtered `findMany` returning
 * `{ id: string }` rows — accumulating ids until either the query runs dry or `cap` is reached.
 */
export async function collectIdsOlderThan(
  findPage: (skip: number, take: number) => Promise<{ id: string }[]>,
  cap: number,
  pageSize: number = PAGE_SIZE,
): Promise<string[]> {
  const ids: string[] = [];
  let skip = 0;

  while (ids.length < cap) {
    const take = Math.min(pageSize, cap - ids.length);
    const page = await findPage(skip, take);
    if (page.length === 0) break;
    ids.push(...page.map(row => row.id));
    skip += page.length;
    if (page.length < take) break;
  }

  return ids;
}

/**
 * Deletes `ids` via `deleteMany(chunk)` in sequential chunks of `batchSize`, so a large id array
 * never becomes a single unbounded `IN (...)` clause. Returns the total row count reported by
 * `deleteMany` across all chunks.
 */
export async function deleteIdsInBatches(
  deleteMany: (ids: string[]) => Promise<number>,
  ids: string[],
  batchSize: number = BATCH_SIZE,
): Promise<number> {
  let deleted = 0;
  for (let i = 0; i < ids.length; i += batchSize) {
    deleted += await deleteMany(ids.slice(i, i + batchSize));
  }
  return deleted;
}
