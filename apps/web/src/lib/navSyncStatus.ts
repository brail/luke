import type { useFormatDate } from '../hooks/useFormatDate';

/**
 * The "last sync" and "next sync" labels of a NAV sync card: when the header table last synced,
 * and, with the replica's automatic sync on, when it is due next.
 */
export function syncStatusInfo(
  state:
    | {
        tables: { tableName: string; lastSyncedAt: Date | string | null }[];
        schedule: { autoSyncEnabled: boolean; intervalMinutes: number } | null;
      }
    | null
    | undefined,
  tableName: string,
  fmt: Pick<ReturnType<typeof useFormatDate>, 'dateTime' | 'relative'>,
): { lastSyncLabel: string; nextSyncLabel: string | null } | null {
  const lastSyncedAt = state?.tables.find(t => t.tableName === tableName)?.lastSyncedAt;
  if (!lastSyncedAt) return null;
  const lastSync = new Date(lastSyncedAt);
  const lastSyncLabel = `${fmt.dateTime(lastSync)} (${fmt.relative(lastSync)})`;
  const schedule = state?.schedule;
  if (!schedule?.autoSyncEnabled || !schedule.intervalMinutes) return { lastSyncLabel, nextSyncLabel: null };
  const nextSync = new Date(lastSync.getTime() + schedule.intervalMinutes * 60_000);
  const nextSyncLabel = nextSync.getTime() - Date.now() < 60_000 ? 'imminente' : fmt.relative(nextSync, { ahead: true });
  return { lastSyncLabel, nextSyncLabel };
}
