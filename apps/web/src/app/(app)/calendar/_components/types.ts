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
}
