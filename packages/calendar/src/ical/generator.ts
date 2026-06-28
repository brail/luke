import ical, { ICalEventStatus } from 'ical-generator';

/**
 * Minimal milestone data required to generate an iCal event.
 */
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

/**
 * Generates an iCal (`.ics`) feed string from a list of milestones.
 *
 * All-day events use the plain `date` format; timed events use `dateTime` with UTC.
 * Milestone status is mapped: `CANCELLED` → CANCELLED, `PLANNED` → TENTATIVE, others → CONFIRMED.
 *
 * @param milestones - Array of milestone data to include in the feed
 * @param calendarName - Display name of the calendar (CALNAME property)
 * @param prodId - iCal PRODID string (defaults to `'-//Luke//SeasonCalendar//EN'`)
 * @returns RFC 5545-compliant iCal string
 */
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
