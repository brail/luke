export interface CalendarMilestoneItem {
  id: string;
  title: string;
  startAt: Date | string;
  endAt?: Date | string | null;
  status: string;
  type: string;
  ownerFunctionId: string;
  brandId?: string | null;
  visibilities: { functionId: string }[];
}
