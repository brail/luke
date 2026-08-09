/**
 * In-memory presence store.
 * Tracks currently online users via periodic heartbeats.
 * State is volatile — it resets on server restart, which is the intended behaviour.
 */

const ONLINE_TTL_MS = 2 * 60 * 1000; // 2 minuti

const presenceMap = new Map<string, number>(); // userId -> timestamp ultimo heartbeat

/**
 * Records or refreshes a user's last-seen timestamp.
 * Call this on every heartbeat request from the client.
 */
export function updatePresence(userId: string): void {
  presenceMap.set(userId, Date.now());
}

/**
 * Returns `true` if the user sent a heartbeat within the last 2 minutes.
 */
export function isUserOnline(userId: string): boolean {
  const lastSeen = presenceMap.get(userId);
  return lastSeen !== undefined && Date.now() - lastSeen < ONLINE_TTL_MS;
}

/**
 * Returns the set of user IDs whose last heartbeat is within the 2-minute TTL.
 * Expired entries are removed from the map as a side effect.
 */
export function getOnlineUserIds(): Set<string> {
  const now = Date.now();
  const onlineIds = new Set<string>();
  for (const [userId, ts] of presenceMap) {
    if (now - ts < ONLINE_TTL_MS) {
      onlineIds.add(userId);
    } else {
      presenceMap.delete(userId);
    }
  }
  return onlineIds;
}
