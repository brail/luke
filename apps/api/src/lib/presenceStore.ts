/**
 * Presence store in-memory
 * Traccia gli utenti attualmente online tramite heartbeat periodico.
 * Lo stato è volatile: si azzera al restart del server (comportamento accettabile).
 */

const ONLINE_TTL_MS = 2 * 60 * 1000; // 2 minuti

const presenceMap = new Map<string, number>(); // userId -> timestamp ultimo heartbeat

/**
 * Aggiorna il timestamp di presenza per un utente
 */
export function updatePresence(userId: string): void {
  presenceMap.set(userId, Date.now());
}

/**
 * Verifica se un utente è online (heartbeat negli ultimi 2 minuti)
 */
export function isUserOnline(userId: string): boolean {
  const lastSeen = presenceMap.get(userId);
  return lastSeen !== undefined && Date.now() - lastSeen < ONLINE_TTL_MS;
}

/**
 * Restituisce il Set degli userId attualmente online.
 * Rimuove contestualmente le entry scadute.
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
