/** Full Italian month names, index 0 = January. */
export const MONTH_NAMES_IT = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio',
  'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];

/** Abbreviated Italian month names, index 0 = January. */
export const MONTH_NAMES_SHORT_IT = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu',
  'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];

/** Abbreviated Italian weekday labels starting from Monday. */
export const DAY_LABELS_IT = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];

/** Human-readable labels for calendar event types. */
export const TYPE_LABELS: Record<string, string> = {
  KICKOFF: 'Kickoff',
  REVIEW: 'Review',
  GATE: 'Gate',
  DEADLINE: 'Deadline',
  MILESTONE: 'Milestone',
  CUSTOM: 'Custom',
};

/** Human-readable labels for calendar event statuses. */
export const STATUS_LABELS: Record<string, string> = {
  PLANNED: 'Pianificato',
  IN_PROGRESS: 'In corso',
  COMPLETED: 'Completato',
  CANCELLED: 'Annullato',
};

/** Badge variant per calendar event status for consistent visual encoding. */
export const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  PLANNED: 'outline',
  IN_PROGRESS: 'default',
  COMPLETED: 'secondary',
  CANCELLED: 'destructive',
};

/** Tailwind opacity/decoration classes applied to event chips per status. */
export const STATUS_OPACITY: Record<string, string> = {
  PLANNED: 'opacity-70',
  IN_PROGRESS: 'opacity-100',
  COMPLETED: 'opacity-40',
  CANCELLED: 'opacity-25 line-through',
};
