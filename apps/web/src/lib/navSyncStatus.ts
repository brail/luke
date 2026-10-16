/** The formatters `syncStatusInfo` writes with: the reader-zone ones of `useFormatDate`. */
interface SyncLabelFormatters {
  dateTime: (value: Date) => string;
  relative: (value: Date, options?: { ahead?: boolean }) => string;
}

/**
 * The "last sync" and "next sync" labels of a NAV sync card: when the header table last synced,
 * and, with auto-sync on, when it is due next.
 */
export function syncStatusInfo(
  state: { tables: { tableName: string; lastSyncedAt: Date | string | null }[] } | null | undefined,
  schedule: { autoSyncEnabled: boolean; intervalMinutes: number } | null | undefined,
  tableName: string,
  fmt: SyncLabelFormatters,
): { lastSyncLabel: string; nextSyncLabel: string | null } | null {
  const lastSyncedAt = state?.tables.find(t => t.tableName === tableName)?.lastSyncedAt;
  if (!lastSyncedAt) return null;
  const lastSync = new Date(lastSyncedAt);
  const lastSyncLabel = `${fmt.dateTime(lastSync)} (${fmt.relative(lastSync)})`;
  if (!schedule?.autoSyncEnabled || !schedule.intervalMinutes) return { lastSyncLabel, nextSyncLabel: null };
  const nextSync = new Date(lastSync.getTime() + schedule.intervalMinutes * 60_000);
  const nextSyncLabel = nextSync.getTime() - Date.now() < 60_000 ? 'imminente' : fmt.relative(nextSync, { ahead: true });
  return { lastSyncLabel, nextSyncLabel };
}
