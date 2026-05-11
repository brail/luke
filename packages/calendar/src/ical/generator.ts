import ical, { ICalEventStatus } from 'ical-generator';

export interface ICalMilestone {
  id: string;
  title: string;
  description?: string | null;
  startAt: Date;
  endAt?: Date | null;
  allDay: boolean;
  status: string;
  brandCode: string;
  sectionKey?: string;
}

function milestoneStatusToIcal(status: string): ICalEventStatus {
  if (status === 'CANCELLED') return ICalEventStatus.CANCELLED;
  if (status === 'PLANNED') return ICalEventStatus.TENTATIVE;
  return ICalEventStatus.CONFIRMED;
}

export function generateIcal(
  milestones: ICalMilestone[],
  calendarName: string,
  prodId: string = '-//Luke//SeasonCalendar//EN'
): string {
  const cal = ical({ name: calendarName, prodId });

  for (const m of milestones) {
    const end = m.endAt ?? m.startAt;
    cal.createEvent({
      id: `luke-milestone-${m.id}@luke.app`,
      summary: m.allDay ? m.title : `[${m.brandCode}] ${m.title}`,
      description: m.description ?? undefined,
      start: m.startAt,
      end,
      allDay: m.allDay,
      status: milestoneStatusToIcal(m.status),
    });
  }

  return cal.toString();
}
