'use client';

import { Calendar, RefreshCw, Copy, Plus, List, GanttChart, CalendarRange, CalendarDays, Maximize2, Minimize2 } from 'lucide-react';
import { useState, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';

import { PLANNING_SECTION_KEYS, type PlanningSectionKey } from '@luke/core';

import { SectionCard } from '../../../components/SectionCard';
import { Button } from '../../../components/ui/button';
import { Card, CardContent } from '../../../components/ui/card';
import { Checkbox } from '../../../components/ui/checkbox';
import { useAppContext } from '../../../contexts/AppContextProvider';
import { usePermission } from '../../../hooks/usePermission';
import { useSectionAccess } from '../../../hooks/useSectionAccess';
import { trpc } from '../../../lib/trpc';
import { getTrpcErrorMessage } from '../../../lib/trpcErrorMessages';
import { cn } from '../../../lib/utils';

import { ApplyTemplateDialog } from './_components/ApplyTemplateDialog';
import { CloneBrandSeasonDialog } from './_components/CloneBrandSeasonDialog';
import { ExportButton } from './_components/ExportButton';
import { MilestoneDetailDrawer } from './_components/MilestoneDetailDrawer';
import { MilestoneDialog } from './_components/MilestoneDialog';
import { MilestoneGantt } from './_components/MilestoneGantt';
import { MilestoneMonthView } from './_components/MilestoneMonthView';
import { MilestoneTimeline } from './_components/MilestoneTimeline';
import { MilestoneWeekView } from './_components/MilestoneWeekView';
import { SECTION_LABELS } from './constants';
import { brandColor } from './utils';

export default function CalendarPage() {
  const { brand, season, isLoading: contextLoading } = useAppContext();
  const { can } = usePermission();
  const sectionAccess = useSectionAccess();

  const accessibleSections = useMemo(
    () => PLANNING_SECTION_KEYS.filter(k => sectionAccess[k]),
    [sectionAccess]
  );

  const [selectedBrandIds, setSelectedBrandIds] = useState<string[]>([]);
  const [selectedSections, setSelectedSections] = useState<PlanningSectionKey[]>([]);
  const [activeMilestoneId, setActiveMilestoneId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [cloneOpen, setCloneOpen] = useState(false);
  const [view, setView] = useState<'list' | 'gantt' | 'week' | 'month'>('list');
  const [viewDate, setViewDate] = useState<Date>(() => new Date());
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    if (!isFullscreen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsFullscreen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isFullscreen]);

  const contextBrandId = brand?.id ?? null;
  const enabled = !!contextBrandId && !!season?.id;

  useEffect(() => {
    if (contextBrandId && !selectedBrandIds.includes(contextBrandId)) {
      setSelectedBrandIds(prev => [...prev, contextBrandId]);
    }
  }, [contextBrandId]); // intentional: only seed brand on context change, not on selectedBrandIds change

  useEffect(() => {
    if (accessibleSections.length > 0 && selectedSections.length === 0) {
      setSelectedSections([...accessibleSections]);
    }
  }, [accessibleSections]); // intentional: only initialize when empty, not on every sections change

  const { data: brandsData } = trpc.brand.list.useQuery(
    { isActive: true, limit: 100 },
    { enabled }
  );

  const { data: calendar, isLoading: calendarLoading } = trpc.seasonCalendar.getOrCreate.useQuery(
    { brandId: contextBrandId ?? '', seasonId: season?.id ?? '' },
    { enabled }
  );

  const { data: milestones, isLoading: milestonesLoading, refetch } = trpc.seasonCalendar.listMilestones.useQuery(
    {
      seasonId: season?.id ?? '',
      brandIds: selectedBrandIds.length > 0 ? selectedBrandIds : [contextBrandId ?? ''],
    },
    { enabled: enabled && selectedBrandIds.length > 0 }
  );

  const { data: syncStatus } = trpc.seasonCalendar.getSyncStatus.useQuery(
    { calendarId: calendar?.id ?? '' },
    { enabled: !!calendar?.id }
  );

  const triggerSyncMutation = trpc.seasonCalendar.triggerSync.useMutation({
    onSuccess: () => {
      toast.success('Sincronizzazione avviata');
      void refetch();
    },
    onError: err => toast.error(getTrpcErrorMessage(err)),
  });

  const canSync = can('season_calendar:sync');
  const canUpdate = can('season_calendar:update');

  const filteredMilestones = useMemo(() => {
    if (!milestones) return [];
    if (selectedSections.length === 0) return milestones;
    return milestones.filter(m =>
      m.visibilities.some(v => selectedSections.includes(v.sectionKey as PlanningSectionKey))
    );
  }, [milestones, selectedSections]);

  const activeMilestone = useMemo(
    () => filteredMilestones.find(m => m.id === activeMilestoneId) ?? null,
    [filteredMilestones, activeMilestoneId]
  );

  const allBrands = brandsData?.items ?? [];
  const multiBrandAvailable = allBrands.length > 1;

  const toggleBrand = (brandId: string) => {
    setSelectedBrandIds(prev =>
      prev.includes(brandId) ? prev.filter(id => id !== brandId) : [...prev, brandId]
    );
  };

  if (!enabled && !contextLoading) {
    return (
      <Card>
        <CardContent>
          <div className="flex flex-col items-center gap-2 py-12 text-muted-foreground">
            <Calendar size={32} />
            <p>Seleziona un brand e una stagione per visualizzare il calendario</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const actionBar = (
    <div className="flex gap-2 items-center">
      {canUpdate && (
        <>
          <Button size="sm" onClick={() => setCreateOpen(true)} disabled={!calendar}>
            <Plus size={14} className="mr-1" />
            Nuova milestone
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCloneOpen(true)}
            disabled={!calendar}
          >
            <Copy size={14} className="mr-1" />
            Clona da…
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setTemplateOpen(true)}
            disabled={!calendar}
          >
            Applica template
          </Button>
        </>
      )}
      <div className="flex border rounded-md overflow-hidden">
        <Button
          variant={view === 'list' ? 'default' : 'ghost'}
          size="sm"
          className="rounded-none border-0"
          onClick={() => setView('list')}
          title="Lista"
        >
          <List size={14} />
        </Button>
        <Button
          variant={view === 'week' ? 'default' : 'ghost'}
          size="sm"
          className="rounded-none border-0"
          onClick={() => setView('week')}
          title="Settimana"
        >
          <CalendarRange size={14} />
        </Button>
        <Button
          variant={view === 'month' ? 'default' : 'ghost'}
          size="sm"
          className="rounded-none border-0"
          onClick={() => setView('month')}
          title="Mese"
        >
          <CalendarDays size={14} />
        </Button>
        <Button
          variant={view === 'gantt' ? 'default' : 'ghost'}
          size="sm"
          className="rounded-none border-0"
          onClick={() => setView('gantt')}
          title="Gantt"
        >
          <GanttChart size={14} />
        </Button>
      </div>
      <ExportButton
        seasonId={season?.id ?? ''}
        brandIds={selectedBrandIds}
        view={view}
        viewDate={viewDate}
        disabled={!season?.id}
      />
      {canSync && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => calendar && triggerSyncMutation.mutate({ calendarId: calendar.id })}
          disabled={!calendar || triggerSyncMutation.isPending}
        >
          <RefreshCw size={14} className={`mr-1 ${triggerSyncMutation.isPending ? 'animate-spin' : ''}`} />
          Sincronizza
        </Button>
      )}
    </div>
  );

  const calendarBody = (
    <div className="flex gap-4">
      <div className="w-56 shrink-0 space-y-4">
        {multiBrandAvailable && (
          <SectionCard title="Brand">
            <div className="space-y-2">
              {allBrands.map(b => {
                const isActive = b.id === contextBrandId;
                return (
                  <label
                    key={b.id}
                    className={cn(
                      'flex items-center gap-2 cursor-pointer rounded px-1.5 py-0.5 -mx-1.5 transition-colors',
                      isActive && 'bg-muted font-medium'
                    )}
                  >
                    <Checkbox
                      checked={selectedBrandIds.includes(b.id)}
                      onCheckedChange={() => toggleBrand(b.id)}
                    />
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ background: brandColor(b.id) }}
                    />
                    <span className="text-sm truncate">{b.name}</span>
                  </label>
                );
              })}
            </div>
          </SectionCard>
        )}
        <SectionCard title="Sezioni">
          <div className="space-y-2">
            {accessibleSections.map(sk => (
              <label key={sk} className="flex items-center gap-2 cursor-pointer">
                <Checkbox
                  checked={selectedSections.includes(sk)}
                  onCheckedChange={checked => {
                    setSelectedSections(prev =>
                      checked ? [...prev, sk] : prev.filter(s => s !== sk)
                    );
                  }}
                />
                <span className="text-sm">{SECTION_LABELS[sk]}</span>
              </label>
            ))}
          </div>
        </SectionCard>
        {syncStatus && (
          <SectionCard title="Sync Google">
            <div className="space-y-1 text-xs text-muted-foreground">
              <p>{syncStatus.totalSynced} eventi sincronizzati</p>
              {syncStatus.lastSyncedAt && (
                <p>Ultimo sync: {new Date(syncStatus.lastSyncedAt).toLocaleString('it-IT')}</p>
              )}
            </div>
          </SectionCard>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <Card>
          <CardContent className="p-0">
            {calendarLoading || milestonesLoading ? (
              <div className="py-12 text-center text-muted-foreground">Caricamento…</div>
            ) : view === 'week' ? (
              <MilestoneWeekView
                milestones={filteredMilestones}
                viewDate={viewDate}
                onViewDateChange={setViewDate}
                onMilestoneClick={id => setActiveMilestoneId(id)}
                activeBrandId={contextBrandId ?? undefined}
              />
            ) : view === 'month' ? (
              <MilestoneMonthView
                milestones={filteredMilestones}
                viewDate={viewDate}
                onViewDateChange={setViewDate}
                onMilestoneClick={id => setActiveMilestoneId(id)}
                activeBrandId={contextBrandId ?? undefined}
              />
            ) : filteredMilestones.length === 0 ? (
              <div className="py-12 text-center text-muted-foreground">
                <Calendar size={32} className="mx-auto mb-2 opacity-40" />
                <p>Nessuna milestone per i filtri selezionati</p>
                {canUpdate && calendar && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-3"
                    onClick={() => setCreateOpen(true)}
                  >
                    <Plus size={14} className="mr-1" />
                    Crea la prima milestone
                  </Button>
                )}
              </div>
            ) : view === 'gantt' ? (
              <MilestoneGantt
                milestones={filteredMilestones}
                onMilestoneClick={id => setActiveMilestoneId(id)}
                activeBrandId={contextBrandId ?? undefined}
              />
            ) : (
              <MilestoneTimeline
                milestones={filteredMilestones}
                onMilestoneClick={id => setActiveMilestoneId(id)}
                activeBrandId={contextBrandId ?? undefined}
              />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );

  return (
    <>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Calendario Stagionale</h1>
          {season && (
            <p className="text-muted-foreground mt-1">
              {season.name}{season.year ? ` · ${season.year}` : ''}
            </p>
          )}
        </div>
        <div className="flex gap-2 items-center">
          {actionBar}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsFullscreen(true)}
            title="Espandi"
          >
            <Maximize2 size={14} />
          </Button>
        </div>
      </div>

      {!isFullscreen && calendarBody}

      {isFullscreen &&
        createPortal(
          <div className="fixed inset-0 z-50 bg-background flex flex-col">
            <div className="shrink-0 border-b px-6 py-3 flex items-center justify-between bg-card">
              <div className="flex items-center gap-3">
                <span className="font-semibold text-sm">Calendario Stagionale</span>
                {season && (
                  <span className="text-sm text-muted-foreground">
                    {season.name}{season.year ? ` · ${season.year}` : ''}
                  </span>
                )}
              </div>
              <div className="flex gap-2 items-center">
                {actionBar}
                <Button variant="ghost" size="sm" onClick={() => setIsFullscreen(false)} title="Riduci">
                  <Minimize2 size={14} />
                </Button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              {calendarBody}
            </div>
          </div>,
          document.body
        )}

      {activeMilestone && (
        <MilestoneDetailDrawer
          milestone={activeMilestone}
          open={!!activeMilestoneId}
          onClose={() => setActiveMilestoneId(null)}
          onUpdated={() => void refetch()}
          canUpdate={canUpdate}
          calendarId={calendar?.id ?? ''}
          accessibleSections={accessibleSections}
        />
      )}

      {calendar && createOpen && (
        <MilestoneDialog
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          onSaved={() => { setCreateOpen(false); void refetch(); }}
          calendarId={calendar.id}
          accessibleSections={accessibleSections}
        />
      )}

      {calendar && templateOpen && (
        <ApplyTemplateDialog
          open={templateOpen}
          onClose={() => setTemplateOpen(false)}
          onApplied={() => { setTemplateOpen(false); void refetch(); }}
          calendarId={calendar.id}
          hasMilestones={(milestones?.length ?? 0) > 0}
        />
      )}

      {calendar && cloneOpen && season && (
        <CloneBrandSeasonDialog
          open={cloneOpen}
          onClose={() => setCloneOpen(false)}
          onCloned={() => { setCloneOpen(false); void refetch(); }}
          targetBrandId={contextBrandId ?? ''}
          targetSeasonId={season.id}
        />
      )}
    </>
  );
}
