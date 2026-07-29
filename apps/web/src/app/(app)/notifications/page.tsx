'use client';

import { useState } from 'react';

import { notificationCategoryEnum, type NotificationCategory } from '@luke/core';

import { NotificationRow } from '../../../components/NotificationRow';
import { PageHeader } from '../../../components/PageHeader';
import { Button } from '../../../components/ui/button';
import { Card, CardContent } from '../../../components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../components/ui/select';
import { Separator } from '../../../components/ui/separator';
import { Skeleton } from '../../../components/ui/skeleton';
import { Switch } from '../../../components/ui/switch';
import { useNotificationCenter } from '../../../hooks/use-notification-center';
import { NOTIFICATION_CATEGORY_META } from '../../../lib/notificationCategoryMeta';
import { trpc } from '../../../lib/trpc';

type CategoryFilter = NotificationCategory | 'ALL';

/**
 * Full notification history — infinite scroll, category/read/archived filters.
 * The bell dropdown stays a lightweight preview of the most recent items; this page
 * is where older, already-read notifications remain reachable.
 */
export default function NotificationsPage() {
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('ALL');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [includeArchived, setIncludeArchived] = useState(false);

  const {
    notifications,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    fetchNextPage,
    refetch,
  } = useNotificationCenter({
    unreadOnly,
    includeArchived,
    category: categoryFilter === 'ALL' ? undefined : categoryFilter,
  });

  const markAsReadMutation = trpc.notifications.markAsRead.useMutation({ onSuccess: refetch });
  const handleMarkAsRead = (id: string) => markAsReadMutation.mutate({ id });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Notifiche"
        description="Storico completo delle tue notifiche, comprese quelle già lette"
      />

      <div className="flex flex-wrap items-center gap-4">
        <Select value={categoryFilter} onValueChange={v => setCategoryFilter(v as CategoryFilter)}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Categoria" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Tutte le categorie</SelectItem>
            {notificationCategoryEnum.options.map(category => (
              <SelectItem key={category} value={category}>
                {NOTIFICATION_CATEGORY_META[category]?.label ?? category}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <label className="flex items-center gap-2 text-sm">
          <Switch checked={unreadOnly} onCheckedChange={setUnreadOnly} />
          Solo non lette
        </label>

        <label className="flex items-center gap-2 text-sm">
          <Switch checked={includeArchived} onCheckedChange={setIncludeArchived} />
          Mostra archiviate
        </label>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-4 p-4">
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-16 w-full" />)}
            </div>
          ) : notifications.length === 0 ? (
            <div className="py-16 text-center text-sm text-muted-foreground">
              Nessuna notifica trovata
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
        </CardContent>
      </Card>

      {hasNextPage && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            onClick={() => fetchNextPage()}
            disabled={isFetchingNextPage}
          >
            {isFetchingNextPage ? 'Caricamento...' : 'Carica altre'}
          </Button>
        </div>
      )}
    </div>
  );
}
