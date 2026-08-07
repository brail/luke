'use client';

import { Archive, Bell, Check } from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';

import { useNotifications } from '../hooks/use-notifications';
import { trpc } from '../lib/trpc';

import { NotificationRow } from './NotificationRow';
import { Button } from './ui/button';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { Separator } from './ui/separator';

function formatCountsLabel(unread: number, read: number): string | null {
  if (unread + read === 0) return null;
  const parts: string[] = [];
  if (unread > 0) parts.push(`${unread} non lett${unread === 1 ? 'a' : 'e'}`);
  if (read > 0) parts.push(`${read} lett${read === 1 ? 'a' : 'e'}`);
  return parts.join(' · ');
}

/**
 * Bell icon dropdown that displays the current user's notifications.
 *
 * Refetches the notification list on popover open. Clicking an unread item marks it
 * as read. Provides bulk "mark all as read" and "archive read" actions.
 */
export function NotificationDropdown() {
  const { notifications, unreadCount, readCount, refetch } = useNotifications();
  const markAsReadMutation = trpc.notifications.markAsRead.useMutation({
    onSuccess: refetch,
  });
  const markAllMutation = trpc.notifications.markAllAsRead.useMutation({
    onSuccess: () => {
      refetch();
      toast.success('Tutte le notifiche segnate come lette');
    },
  });
  const archiveReadMutation = trpc.notifications.archiveRead.useMutation({
    onSuccess: () => {
      refetch();
      toast.success('Notifiche lette archiviate');
    },
  });

  const handleMarkAsRead = (id: string) => markAsReadMutation.mutate({ id });

  const countsLabel = formatCountsLabel(unreadCount, readCount);

  return (
    <Popover onOpenChange={open => { if (open) refetch(); }}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="h-5 w-5" />
          {/* 9px: below Tailwind's text-xs (12px) floor; unread-count bubble must stay tiny */}
          {unreadCount > 0 && (
            <span className="absolute top-0.5 right-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-bold leading-none text-destructive-foreground">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-80 p-0">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <div className="flex flex-col">
            <span className="font-semibold text-sm">Notifiche</span>
            {/* 11px: below Tailwind's text-xs (12px) floor; dense header sub-caption */}
            {countsLabel && (
              <span className="text-[11px] text-muted-foreground">{countsLabel}</span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {unreadCount > 0 && (
              <Button
                variant="ghost"
                size="xs"
                className="px-2"
                onClick={() => markAllMutation.mutate()}
                disabled={markAllMutation.isPending}
              >
                <Check className="h-3 w-3 mr-1" />
                Segna tutte
              </Button>
            )}
            <Button
              variant="ghost"
              size="xs"
              className="px-2 text-muted-foreground"
              onClick={() => archiveReadMutation.mutate()}
              disabled={archiveReadMutation.isPending}
            >
              <Archive className="h-3 w-3" />
            </Button>
          </div>
        </div>

        {/* Lista — 360px: fits ~6 notification rows before scrolling; no exact Tailwind scale match */}
        <div className="max-h-[360px] overflow-y-auto">
          {notifications.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              Nessuna notifica
            </div>
          ) : (
            <div>
              {notifications.map((n, i) => (
                <div key={n.id}>
                  {i > 0 && <Separator />}
                  <NotificationRow notification={n} onMarkAsRead={handleMarkAsRead} />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t px-4 py-2 flex items-center justify-between">
          <Link
            href="/notifications"
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Vedi tutte →
          </Link>
          <Link
            href="/profile"
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Impostazioni notifiche →
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
