'use client';

import { useEffect, useState } from 'react';

import {
  DEFAULT_CLOCKS_TIMEZONES,
  DEFAULT_LOCALE,
  formatInstant,
  NUMERIC_TIME,
  wallClockDate,
  type ClocksSettings,
} from '@luke/core';

import { cn } from '../../../lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';

const TZ_LABELS: Record<string, string> = {
  'Europe/Rome': 'Milano',
  'Asia/Shanghai': 'Shanghai',
  'America/New_York': 'New York',
  'Europe/London': 'Londra',
  'America/Los_Angeles': 'Los Angeles',
  'Asia/Tokyo': 'Tokyo',
  'Australia/Sydney': 'Sydney',
  'America/Chicago': 'Chicago',
};

function formatTime(tz: string, now: Date): string {
  return formatInstant(now, tz, NUMERIC_TIME, DEFAULT_LOCALE);
}

function getLabel(tz: string): string {
  return TZ_LABELS[tz] ?? tz.split('/').pop()?.replaceAll('_', ' ') ?? tz;
}

function getShanghaiHour(now: Date): number {
  return wallClockDate(now, 'Asia/Shanghai').getUTCHours();
}

function getCnWindowStatus(shanghaiHour: number): { open: boolean; suffix: string } {
  if (shanghaiHour >= 9 && shanghaiHour < 18) return { open: true,  suffix: 'chiusura alle 18:00'     };
  if (shanghaiHour < 9)                        return { open: false, suffix: 'apertura alle 09:00'     };
  return                                               { open: false, suffix: 'riapertura domani 09:00' };
}

/**
 * Dashboard widget showing world clocks for a configurable list of IANA timezones.
 *
 * The first two timezones are displayed as large primary clocks; additional ones appear
 * as a compact list. Shows a China business-hours indicator based on the Asia/Shanghai time.
 * Updates every second but re-renders only when the minute changes.
 *
 * @param settings - Widget settings typed as `ClocksSettings`; falls back to `DEFAULT_CLOCKS_TIMEZONES`.
 */
export function ClocksWidget({ settings }: { settings?: Record<string, unknown> }) {
  const [now, setNow] = useState<Date | null>(null);
  // Valid zones: the settings are checked on save, and dropped on read when stored before that.
  const timezones = (settings as ClocksSettings | undefined)?.timezones ?? [...DEFAULT_CLOCKS_TIMEZONES];

  useEffect(() => {
    setNow(new Date());
    const timer = setInterval(() => {
      setNow(prev => {
        const next = new Date();
        // A new minute of the instant is a new minute on every clock (zone offsets are whole minutes).
        if (prev && Math.floor(prev.getTime() / 60_000) === Math.floor(next.getTime() / 60_000)) return prev;
        return next;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const [primary, secondary, ...rest] = timezones;
  const cnStatus = now ? getCnWindowStatus(getShanghaiHour(now)) : null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold">Orari</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-start justify-around gap-2">
          {primary && now && (
            <div className="text-center">
              <div className="text-4xl font-mono font-bold tabular-nums leading-none">
                {formatTime(primary, now)}
              </div>
              <div className="text-xs text-muted-foreground mt-1">{getLabel(primary)}</div>
            </div>
          )}
          {secondary && now && (
            <div className="text-center">
              <div className="text-4xl font-mono font-bold tabular-nums leading-none">
                {formatTime(secondary, now)}
              </div>
              <div className="text-xs text-muted-foreground mt-1">{getLabel(secondary)}</div>
            </div>
          )}
        </div>

        {cnStatus && (
          <div className="space-y-0.5">
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Finestra operativa CN
            </div>
            <div className="text-sm">
              <span className={cn(
                'font-medium',
                cnStatus.open ? 'text-green-600 dark:text-green-400' : 'text-amber-600 dark:text-amber-400'
              )}>
                {cnStatus.open ? 'Aperto' : 'Fuori orario'}
              </span>
              {' '}
              <span className="text-muted-foreground">· {cnStatus.suffix}</span>
            </div>
          </div>
        )}

        {rest.length > 0 && now && (
          <div className="space-y-1 pt-1 border-t">
            {rest.map(tz => (
              <div key={tz} className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">{getLabel(tz)}</span>
                <span className="text-sm font-mono font-semibold tabular-nums">
                  {formatTime(tz, now)}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
