/**
 * Normalised shape of a calendar event/milestone used across all calendar views.
 * `_proposed` is set to `true` for what-if preview events that have not been persisted.
 */
export interface CalendarEventItem {
  id: string;
  title: string;
  description?: string | null;
  startAt: Date | string;
  endAt?: Date | string | null;
  allDay: boolean;
  status: string;
  type: string;
  ownerFunctionId: string;
  publishExternally: boolean;
  brandId?: string | null;
  visibilities: { functionId: string }[];
  notes?: { body: string }[];
  severity?: string | null;
  relevantCountries?: string[];
  _proposed?: boolean;
}
