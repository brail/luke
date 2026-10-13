'use client';

import { useEffect, useState } from 'react';

import type { RouterOutputs } from '@luke/api';

import { dailyGreetingSeenKey } from '../lib/dailyGreetingKey';
import { trpc } from '../lib/trpc';

import { useFormatDate } from './useFormatDate';

type DailyGreetingData = Extract<RouterOutputs['me']['getDailyGreeting'], { enabled: true }>;

/**
 * Gates the daily greeting modal to once per day per browser via localStorage, the day being
 * today in the profile zone; until that day is known there is nothing to show.
 * Skips the tRPC call entirely if the flag for today is already set. When the feature is
 * disabled server-side, does not write the flag so the user sees it again if re-enabled
 * later the same day.
 */
export function useDailyGreeting(): {
  shouldShow: boolean;
  data: DailyGreetingData | null;
  dismiss: () => void;
} {
  const { today } = useFormatDate();
  const key = today ? dailyGreetingSeenKey(today) : null;
  const [seen, setSeen] = useState<{ key: string; seen: boolean }>();
  // Read once per day, when it is first known (React's pattern for state set during render): the
  // flag this hook writes below must not hide the greeting it is showing, and a tab open past
  // midnight reads the new day's flag instead of writing it.
  if (key && seen?.key !== key) setSeen({ key, seen: localStorage.getItem(key) === '1' });
  const alreadySeen = !key || seen?.key !== key || seen.seen;

  const { data } = trpc.me.getDailyGreeting.useQuery(undefined, {
    enabled: !alreadySeen,
  });

  useEffect(() => {
    if (key && !alreadySeen && data?.enabled) {
      localStorage.setItem(key, '1');
    }
  }, [key, alreadySeen, data]);

  const dismiss = () => {
    if (key) setSeen({ key, seen: true });
  };

  if (alreadySeen || !data?.enabled) {
    return { shouldShow: false, data: null, dismiss };
  }

  return { shouldShow: true, data, dismiss };
}
