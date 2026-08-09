/** Full Italian month names, index 0 = January. */
export const MONTH_NAMES_IT = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio',
  'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];

/** Abbreviated Italian month names, index 0 = January. */
export const MONTH_NAMES_SHORT_IT = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu',
  'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];

/** Abbreviated Italian weekday labels starting from Monday. */
export const DAY_LABELS_IT = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];

/** Tailwind opacity/decoration classes for an event chip: cancelled events are dimmed + struck through. */
export function cancelledClass(cancelled: boolean): string {
  return cancelled ? 'opacity-25 line-through' : 'opacity-100';
}
