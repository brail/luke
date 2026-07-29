'use client';

import Link from 'next/link';

import type { RouterOutputs } from '@luke/api';

import { NOTIFICATION_CATEGORY_META, formatNotificationRelativeTime } from '../lib/notificationCategoryMeta';
import { cn } from '../lib/utils';

import type { Route } from 'next';

export type NotificationRowItem = RouterOutputs['notifications']['list']['items'][number];

interface NotificationRowProps {
  notification: NotificationRowItem;
  onMarkAsRead: (id: string) => void;
}

/**
 * Single notification row, shared between the bell dropdown and the Notification Center page.
 * Clicking anywhere on the row — including the deep-link — marks the notification as read.
 */
export function NotificationRow({ notification: n, onMarkAsRead }: NotificationRowProps) {
  const handleRowClick = () => {
    if (!n.isRead) onMarkAsRead(n.id);
  };

  return (
    <div
      className={cn(
        'px-4 py-3 cursor-pointer hover:bg-muted/50 transition-colors',
        !n.isRead && 'bg-muted/30'
      )}
      onClick={handleRowClick}
    >
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            <span
              className={cn(
                'text-[10px] font-medium px-1.5 py-0.5 rounded',
                NOTIFICATION_CATEGORY_META[n.category]?.style ?? 'bg-muted text-muted-foreground'
              )}
            >
              {NOTIFICATION_CATEGORY_META[n.category]?.label ?? n.category}
            </span>
            {!n.isRead && (
              <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
            )}
          </div>
          <p className="text-sm font-medium leading-tight truncate">{n.title}</p>
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.message}</p>
          <p className="text-[10px] text-muted-foreground mt-1">
            {formatNotificationRelativeTime(new Date(n.createdAt))}
          </p>
        </div>
      </div>
      {n.link && (
        <Link
          href={n.link as Route}
          className="text-xs text-primary hover:underline mt-1 block"
          onClick={e => {
            e.stopPropagation();
            handleRowClick();
          }}
        >
          Vai →
        </Link>
      )}
    </div>
  );
}
