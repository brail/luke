/** A company function's name, marked when it is no longer active. */
export function functionLabel(fn: { name: string; isActive: boolean }): string {
  return fn.isActive ? fn.name : `${fn.name} (inattiva)`;
}

/**
 * The functions a record's visibility picker offers: every active one, and an inactive one only where
 * the record already has it, so it can be removed — the API refuses adding one (#237).
 */
export function offeredFunctions<F extends { id: string; isActive: boolean }>(all: readonly F[], carriedIds: readonly string[]): F[] {
  return all.filter(fn => fn.isActive || carriedIds.includes(fn.id));
}
