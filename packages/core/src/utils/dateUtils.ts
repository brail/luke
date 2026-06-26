export function daysBetween(a: Date, b: Date): number {
  const msPerDay = 1000 * 60 * 60 * 24;
  const utcA = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const utcB = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((utcB - utcA) / msPerDay);
}

export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

export interface WorkingDayHoliday {
  countryCode: string;
  startDate: Date;
  endDate: Date;
}

export function isWorkingDay(
  date: Date,
  countryCodes: string[],
  holidays: WorkingDayHoliday[],
): boolean {
  const dow = date.getDay();
  if (dow === 0 || dow === 6) return false;

  const utcDate = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  for (const h of holidays) {
    if (countryCodes.length > 0 && !countryCodes.includes(h.countryCode)) continue;
    const utcStart = Date.UTC(h.startDate.getFullYear(), h.startDate.getMonth(), h.startDate.getDate());
    const utcEnd   = Date.UTC(h.endDate.getFullYear(),   h.endDate.getMonth(),   h.endDate.getDate());
    if (utcDate >= utcStart && utcDate <= utcEnd) return false;
  }

  return true;
}

export function workingDaysBetween(
  from: Date,
  to: Date,
  countryCodes: string[],
  holidays: WorkingDayHoliday[],
): number {
  const forward = to >= from;
  const [start, end] = forward ? [from, to] : [to, from];
  let count = 0;
  const current = new Date(start);
  while (current <= end) {
    if (isWorkingDay(current, countryCodes, holidays)) count++;
    current.setDate(current.getDate() + 1);
  }
  return forward ? count : -count;
}
