'use client';

import { Bell, Check, Trash2 } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { toast } from 'sonner';

import { cn } from '../lib/utils';
import { trpc } from '../lib/trpc';
import { useNotifications } from '../hooks/use-notifications';
import { Button } from './ui/button';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { ScrollArea } from './ui/scroll-area';
import { Separator } from './ui/separator';

const NOTIFICATION_CATEGORY: Record<string, { style: string; label: string }> = {
  SYSTEM:      { style: 'bg-blue-100 text-blue-700',   label: 'Sistema' },
  CALENDAR:    { style: 'bg-yellow-100 text-yellow-700', label: 'Calendario' },
  USER_ACTION: { style: 'bg-green-100 text-green-700',  label: 'Azioni' },
  WORKFLOW:    { style: 'bg-purple-100 text-purple-700', label: 'Workflow' },
};

function formatRelativeTime(date: Date): string {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'ora';
  if (mins < 60) return `${mins} min fa`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} ore fa`;
  return `${Math.floor(hours / 24)} giorni fa`;
}

export function NotificationDropdown() {
  const { notifications, unreadCount, refetch } = useNotifications();
  const markAsReadMutation = trpc.notifications.markAsRead.useMutation({
    onSuccess: refetch,
  });
  const markAllMutation = trpc.notifications.markAllAsRead.useMutation({
    onSuccess: () => {
      refetch();
      toast.success('Tutte le notifiche segnate come lette');
    },
  });
  const deleteReadMutation = trpc.notifications.deleteRead.useMutation({
    onSuccess: () => {
      refetch();
      toast.success('Notifiche lette eliminate');
    },
  });

  const handleItemClick = (id: string, isRead: boolean) => {
    if (!isRead) markAsReadMutation.mutate({ id });
  };

  return (
    <Popover onOpenChange={open => { if (open) refetch(); }}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <span className="absolute top-0.5 right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-destructive text-[9px] font-bold text-destructive-foreground">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-80 p-0">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <span className="font-semibold text-sm">Notifiche</span>
          <div className="flex items-center gap-1">
            {unreadCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs px-2"
                onClick={() => markAllMutation.mutate()}
                disabled={markAllMutation.isPending}
              >
                <Check className="h-3 w-3 mr-1" />
                Segna tutte
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs px-2 text-muted-foreground"
              onClick={() => deleteReadMutation.mutate()}
              disabled={deleteReadMutation.isPending}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        </div>

        {/* Lista */}
        <ScrollArea className="max-h-[360px]">
          {notifications.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              Nessuna notifica
            </div>
          ) : (
            <div>
              {notifications.map((n, i) => (
                <div key={n.id}>
                  {i > 0 && <Separator />}
                  <div
                    className={cn(
                      'px-4 py-3 cursor-pointer hover:bg-muted/50 transition-colors',
                      !n.isRead && 'bg-muted/30'
                    )}
                    onClick={() => handleItemClick(n.id, n.isRead)}
                  >
                    <div className="flex items-start gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <span
                            className={cn(
                              'text-[10px] font-medium px-1.5 py-0.5 rounded',
                              NOTIFICATION_CATEGORY[n.category]?.style ?? 'bg-muted text-muted-foreground'
                            )}
                          >
                            {NOTIFICATION_CATEGORY[n.category]?.label ?? n.category}
                          </span>
                          {!n.isRead && (
                            <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                          )}
                        </div>
                        <p className="text-sm font-medium leading-tight truncate">{n.title}</p>
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.message}</p>
                        <p className="text-[10px] text-muted-foreground mt-1">
                          {formatRelativeTime(new Date(n.createdAt))}
                        </p>
                      </div>
                    </div>
                    {n.link && (
                      <Link
                        href={n.link as Route}
                        className="text-xs text-primary hover:underline mt-1 block"
                        onClick={e => e.stopPropagation()}
                      >
                        Vai →
                      </Link>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>

        {/* Footer */}
        <div className="border-t px-4 py-2">
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
