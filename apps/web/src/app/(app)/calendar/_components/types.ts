/**
 * Normalised shape of a calendar event/milestone used across all calendar views.
 */
export interface CalendarEventItem {
  id: string;
  title: string;
  description?: string | null;
  startAt: Date | string;
  endAt?: Date | string | null;
  baselineStartAt?: Date | string | null;
  baselineEndAt?: Date | string | null;
  allDay: boolean;
  status: string;
  type: string;
  ownerFunctionId: string;
  publishExternally: boolean;
  brandId?: string | null;
  visibilities: { functionId: string }[];
  notes?: { body: string }[];
}
