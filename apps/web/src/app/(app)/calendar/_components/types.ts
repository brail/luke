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
  cancelledAt?: Date | string | null;
  cancelReason?: string | null;
  phaseId?: string | null;
  publishExternally: boolean;
  brandId?: string | null;
  visibilities: { functionId: string }[];
  notes?: { body: string }[];
  planningGroupId: string;
  planningGroupName?: string;
  planningGroupFrozenAt?: Date | string | null;
}
