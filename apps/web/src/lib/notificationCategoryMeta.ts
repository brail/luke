/**
 * Visual style + Italian label/description for each notification category — the single shared
 * source for the bell dropdown, the Notification Center page, and the profile preferences panel.
 */
export const NOTIFICATION_CATEGORY_META: Record<string, { style: string; label: string; description: string }> = {
  SYSTEM: {
    style: 'bg-blue-100 text-blue-700',
    label: 'Sistema',
    description: 'Sincronizzazioni NAV, errori e job di sistema',
  },
  CALENDAR: {
    style: 'bg-yellow-100 text-yellow-700',
    label: 'Calendario',
    description: 'Milestone in scadenza, kickoff e deadline del calendario stagione',
  },
  USER_ACTION: {
    style: 'bg-green-100 text-green-700',
    label: 'Azioni utente',
    description: 'Menzioni, task assegnati e interazioni da altri utenti',
  },
  WORKFLOW: {
    style: 'bg-purple-100 text-purple-700',
    label: 'Workflow',
    description: 'Approvazioni, cambio stato entità e richieste di accesso',
  },
};

export function formatNotificationRelativeTime(date: Date): string {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'ora';
  if (mins < 60) return `${mins} min fa`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} ore fa`;
  return `${Math.floor(hours / 24)} giorni fa`;
}
