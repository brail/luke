'use client';

import type { NotificationCategory } from '@luke/core';

import { trpc } from '../lib/trpc';

interface UseNotificationCenterParams {
  unreadOnly?: boolean;
  includeArchived?: boolean;
  category?: NotificationCategory;
}

/**
 * Infinite-scroll feed for the full Notification Center page, built on the same
 * `notifications.list` cursor pagination already used by the bell dropdown preview.
 *
 * @returns `{ notifications, hasNextPage, isFetchingNextPage, isLoading, fetchNextPage, refetch }`.
 */
export function useNotificationCenter({ unreadOnly, includeArchived, category }: UseNotificationCenterParams) {
  const utils = trpc.useUtils();

  const query = trpc.notifications.list.useInfiniteQuery(
    { limit: 20, unreadOnly, includeArchived, category },
    { getNextPageParam: lastPage => lastPage.nextCursor ?? undefined }
  );

  const notifications = query.data?.pages.flatMap(page => page.items) ?? [];

  return {
    notifications,
    hasNextPage: query.hasNextPage,
    isFetchingNextPage: query.isFetchingNextPage,
    isLoading: query.isLoading,
    fetchNextPage: query.fetchNextPage,
    refetch: () => {
      void utils.notifications.list.invalidate();
      void utils.notifications.counts.invalidate();
    },
  };
}
