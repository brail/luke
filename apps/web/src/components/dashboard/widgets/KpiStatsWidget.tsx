'use client';

import { Boxes, Tag, Users2, Rows3 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { Card, CardContent } from '../../ui/card';
import { Skeleton } from '../../ui/skeleton';
import { trpc } from '../../../lib/trpc';

const STAT_DEFS: {
  label: string;
  key: 'brands' | 'seasons' | 'users' | 'collectionRows';
  unit: string;
  icon: LucideIcon;
}[] = [
  { label: 'Brand attivi',     key: 'brands',         unit: 'brand',   icon: Tag    },
  { label: 'Stagioni attive',  key: 'seasons',        unit: 'stagioni', icon: Boxes  },
  { label: 'Utenti attivi',    key: 'users',          unit: 'utenti',  icon: Users2 },
  { label: 'Righe collezione', key: 'collectionRows', unit: 'righe',   icon: Rows3  },
];

export function KpiStatsWidget() {
  const { data, isLoading } = trpc.dashboard.getKpiStats.useQuery();

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {STAT_DEFS.map(({ label, key, unit, icon: Icon }) => (
        <Card key={key}>
          <CardContent className="pt-5 pb-5">
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
              {label}
            </div>
            {isLoading ? (
              <Skeleton className="h-10 w-20 mb-1" />
            ) : (
              <div className="flex items-baseline gap-1.5">
                <span className="text-4xl font-bold tabular-nums">{data?.[key] ?? 0}</span>
                <span className="text-base text-muted-foreground">{unit}</span>
              </div>
            )}
            <div className="text-xs text-muted-foreground mt-1.5 flex items-center gap-1">
              <Icon className="h-3 w-3" />
              <span>—</span>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
