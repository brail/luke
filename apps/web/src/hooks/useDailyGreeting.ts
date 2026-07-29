'use client';

import { useEffect, useState } from 'react';

import type { RouterOutputs } from '@luke/api';

import { dailyGreetingSeenKey } from '../lib/dailyGreetingKey';
import { trpc } from '../lib/trpc';

type DailyGreetingData = Extract<RouterOutputs['me']['getDailyGreeting'], { enabled: true }>;

/**
 * Gates the daily greeting modal to once per day per browser via localStorage.
 * Skips the tRPC call entirely if the flag for today is already set. When the feature is
 * disabled server-side, does not write the flag so the user sees it again if re-enabled
 * later the same day.
 */
export function useDailyGreeting(): {
  shouldShow: boolean;
  data: DailyGreetingData | null;
  dismiss: () => void;
} {
  const [alreadySeen, setAlreadySeen] = useState(
    () => typeof window !== 'undefined' && localStorage.getItem(dailyGreetingSeenKey()) === '1'
  );

  const { data } = trpc.me.getDailyGreeting.useQuery(undefined, {
    enabled: !alreadySeen,
  });

  useEffect(() => {
    if (!alreadySeen && data?.enabled) {
      localStorage.setItem(dailyGreetingSeenKey(), '1');
    }
  }, [alreadySeen, data]);

  const dismiss = () => setAlreadySeen(true);

  if (alreadySeen || !data?.enabled) {
    return { shouldShow: false, data: null, dismiss };
  }

  return { shouldShow: true, data, dismiss };
}
