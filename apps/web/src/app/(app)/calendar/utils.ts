export function mondayOf(d: Date): Date {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  r.setDate(r.getDate() - ((r.getDay() + 6) % 7));
  return r;
}

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

export function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

export function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** Days from a to b (positive = forward). */
export function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

export function getIsoWeek(d: Date): number {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

const PALETTE = [
  '#2563eb', // blue
  '#dc2626', // red
  '#16a34a', // green
  '#d97706', // amber
  '#7c3aed', // violet
  '#db2777', // pink
  '#0891b2', // cyan
  '#ea580c', // orange
  '#9333ea', // purple
  '#0d9488', // teal
  '#65a30d', // lime
  '#be123c', // rose
];

export function groupEventsByDay<T extends { startAt: Date | string; endAt?: Date | string | null }>(
  events: T[],
  days: Date[],
): T[][] {
  return days.map(day => {
    const dayStart = day.getTime();
    const dayEnd = dayStart + 86_400_000 - 1;
    return events.filter(m => {
      const start = new Date(m.startAt).getTime();
      const end = m.endAt ? new Date(m.endAt).getTime() : start;
      return start <= dayEnd && end >= dayStart;
    });
  });
}

export function canEditMilestone(
  m: { brandId?: string | null },
  canUpdate: boolean | undefined,
  activeBrandId: string | undefined,
): boolean {
  return !!canUpdate && (!m.brandId || m.brandId === activeBrandId);
}

export function brandColor(brandId: string): string {
  let hash = 0;
  for (let i = 0; i < brandId.length; i++) {
    hash = (hash * 31 + brandId.charCodeAt(i)) & 0xffffffff;
  }
  return PALETTE[Math.abs(hash) % PALETTE.length]!;
}

export function assignBrandColors(brands: { id: string }[]): Record<string, string> {
  return Object.fromEntries(brands.map((b, i) => [b.id, PALETTE[i % PALETTE.length]!]));
}

export function resolveBrandColor(brandId: string | null | undefined, map: Record<string, string>): string {
  if (!brandId) return 'hsl(var(--primary))';
  return map[brandId] ?? brandColor(brandId);
}
