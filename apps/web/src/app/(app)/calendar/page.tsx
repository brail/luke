'use client';

import { Calendar, CalendarClock, RefreshCw, Copy, Plus, List, GanttChart, CalendarRange, CalendarDays, Maximize2, Minimize2, ChevronDown, Check, FlaskConical, MoreHorizontal } from 'lucide-react';
import { useState, useMemo, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';

import { Button } from '../../../components/ui/button';
import { Card, CardContent } from '../../../components/ui/card';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '../../../components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '../../../components/ui/popover';
import { useAppContext } from '../../../contexts/AppContextProvider';
import { usePermission } from '../../../hooks/usePermission';
import { trpc } from '../../../lib/trpc';
import { getTrpcErrorMessage } from '../../../lib/trpcErrorMessages';
import { cn } from '../../../lib/utils';

import type { SimulationResult } from '@luke/calendar';

import { ApplyTemplateDialog } from './_components/ApplyTemplateDialog';
import { useHolidays } from './_components/useHolidays';
import { CalendarEventDayView } from './_components/CalendarEventDayView';
import { CalendarEventDialog } from './_components/CalendarEventDialog';
import { CalendarEventGantt } from './_components/CalendarEventGantt';
import { CalendarEventMonthView } from './_components/CalendarEventMonthView';
import { CalendarEventNoteDialog } from './_components/CalendarEventNoteDialog';
import { CalendarEventTimeline } from './_components/CalendarEventTimeline';
import { CalendarEventWeekView } from './_components/CalendarEventWeekView';
import { CloneBrandSeasonDialog } from './_components/CloneBrandSeasonDialog';
import { ExportButton } from './_components/ExportButton';
import { WhatIfBanner } from './_components/WhatIfBanner';
import { addDays, assignBrandColors, daysBetween, resolveBrandColor } from './utils';

export default function CalendarPage() {
  const { brand, season, isLoading: contextLoading } = useAppContext();
  const { can } = usePermission();

  const [selectedBrandIds, setSelectedBrandIds] = useState<string[]>([]);
  const [selectedFunctionIds, setSelectedFunctionIds] = useState<string[]>([]);
  const [activeEventId, setActiveEventId] = useState<string | null>(null);
  const [noteEventId, setNoteEventId] = useState<string | null>(null);
  const [createDate, setCreateDate] = useState<string | null>(null);
  const [createDefaultAllDay, setCreateDefaultAllDay] = useState(true);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [cloneOpen, setCloneOpen] = useState(false);
  const [view, setView] = useState<'list' | 'gantt' | 'week' | 'day' | 'month'>('month');
  const [viewDate, setViewDate] = useState<Date>(() => new Date());
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [simulateMode, setSimulateMode] = useState(false);
  const [proposedShifts, setProposedShifts] = useState<{ eventId: string; newStartAt: string }[]>([]);
  const [simulateResult, setSimulateResult] = useState<SimulationResult | null>(null);

  useEffect(() => {
    if (!isFullscreen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setIsFullscreen(false); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isFullscreen]);

  const contextBrandId = brand?.id ?? null;
  const enabled = !!contextBrandId && !!season?.id;

  useEffect(() => {
    if (contextBrandId && !selectedBrandIds.includes(contextBrandId)) {
      setSelectedBrandIds(prev => [...prev, contextBrandId]);
    }
  }, [contextBrandId]); // intentional: only seed brand on context change

  const { data: brandsData } = trpc.brand.list.useQuery({ isActive: true, limit: 100 }, { enabled });
  const { data: functionsData } = trpc.company.function.list.useQuery(undefined, { enabled });

  const availableFunctions = useMemo(
    () => (functionsData ?? []).map(f => ({ id: f.id, name: f.name })),
    [functionsData]
  );
  const functionsById = useMemo(
    () => Object.fromEntries(availableFunctions.map(f => [f.id, f.name])),
    [availableFunctions]
  );

  useEffect(() => {
    if (availableFunctions.length > 0 && selectedFunctionIds.length === 0) {
      setSelectedFunctionIds(availableFunctions.map(f => f.id));
    }
  }, [availableFunctions]); // intentional: only initialize when empty

  const { data: calendar, isLoading: calendarLoading } = trpc.seasonCalendar.getOrCreate.useQuery(
    { brandId: contextBrandId ?? '', seasonId: season?.id ?? '' },
    { enabled }
  );

  const { data: milestones, isLoading: milestonesLoading, refetch } = trpc.seasonCalendar.listMilestones.useQuery(
    { seasonId: season?.id ?? '', brandIds: selectedBrandIds.length > 0 ? selectedBrandIds : [contextBrandId ?? ''] },
    { enabled: enabled && selectedBrandIds.length > 0 }
  );

  const { data: syncStatus } = trpc.seasonCalendar.getSyncStatus.useQuery(
    { calendarId: calendar?.id ?? '' },
    { enabled: !!calendar?.id }
  );

  const triggerSyncMutation = trpc.seasonCalendar.triggerSync.useMutation({
    onSuccess: () => { toast.success('Sincronizzazione avviata'); void refetch(); },
    onError: err => toast.error(getTrpcErrorMessage(err)),
  });

  const updateEventMutation = trpc.seasonCalendar.updateMilestone.useMutation({
    onSuccess: () => void refetch(),
    onError: err => toast.error(getTrpcErrorMessage(err)),
  });

  const simulateMutation = trpc.seasonCalendar.simulate.useMutation({
    onSuccess: (data) => setSimulateResult(data as SimulationResult),
    onError: (err) => toast.error(getTrpcErrorMessage(err)),
  });

  const handleEventUpdate = (id: string, data: { startAt: string; endAt?: string | null }) => {
    if (simulateMode) {
      setProposedShifts(prev => [...prev.filter(s => s.eventId !== id), { eventId: id, newStartAt: data.startAt }]);
      setSimulateResult(null);
      return;
    }
    updateEventMutation.mutate({ id, data: { ...data, endAt: data.endAt ?? undefined } });
  };

  const deleteEventsMutation = trpc.seasonCalendar.deleteMilestones.useMutation({
    onSuccess: () => void refetch(),
    onError: err => toast.error(getTrpcErrorMessage(err)),
  });

  const canSync = can('season_calendar:sync');
  const canUpdate = can('season_calendar:update');

  const handleDayClick = useCallback((isoDate: string) => { setCreateDefaultAllDay(true); setCreateDate(isoDate); }, []);
  const handleDayClickTimed = useCallback((isoDate: string) => { setCreateDefaultAllDay(false); setCreateDate(isoDate); }, []);
  const onDayClickProp = canUpdate ? handleDayClick : undefined;
  const onDayClickTimedProp = canUpdate ? handleDayClickTimed : undefined;

  const handleDayNumberClick = useCallback((isoDate: string) => {
    setViewDate(new Date(isoDate));
    setView('day');
  }, []);
  const handleWeekNumberClick = useCallback((isoDate: string) => {
    setViewDate(new Date(isoDate));
    setView('week');
  }, []);

  const filteredMilestones = useMemo(() => {
    if (!milestones) return [];
    if (selectedFunctionIds.length === 0) return milestones;
    return milestones.filter(m => m.visibilities.some(v => selectedFunctionIds.includes(v.functionId)));
  }, [milestones, selectedFunctionIds]);

  const handleSimulate = useCallback(() => {
    if (!calendar) return;
    simulateMutation.mutate({
      calendarIds: [calendar.id],
      proposedShifts,
      requestSuggestion: true,
    });
  }, [calendar, proposedShifts, simulateMutation]);

  const handleApplySuggestion = useCallback((shifts: { eventId: string; fromStartAt: string | Date; toStartAt: string | Date; reason: string }[]) => {
    setProposedShifts(shifts.map(s => ({ eventId: s.eventId, newStartAt: new Date(s.toStartAt).toISOString() })));
    setSimulateResult(null);
  }, []);

  const handleApplyShifts = useCallback(async () => {
    const eventMap = new Map(filteredMilestones.map(m => [m.id, m]));
    await Promise.all(proposedShifts.map(shift => {
      const m = eventMap.get(shift.eventId);
      if (!m) return Promise.resolve();
      const delta = daysBetween(new Date(m.startAt), new Date(shift.newStartAt));
      const newEnd = m.endAt ? addDays(new Date(m.endAt), delta).toISOString() : undefined;
      return updateEventMutation.mutateAsync({ id: shift.eventId, data: { startAt: shift.newStartAt, endAt: newEnd } });
    }));
    setSimulateMode(false);
    setProposedShifts([]);
    setSimulateResult(null);
    void refetch();
  }, [proposedShifts, filteredMilestones, updateEventMutation, refetch]);

  const handleResetSimulate = useCallback(() => {
    setSimulateMode(false);
    setProposedShifts([]);
    setSimulateResult(null);
  }, []);

  const { data: holidayCountries = [] } = trpc.holidays.listCountries.useQuery(undefined, { staleTime: 60 * 60 * 1000 });
  const holidayCountryCodes = useMemo(() => holidayCountries.map(c => c.code), [holidayCountries]);
  const holidayDates = useHolidays(holidayCountryCodes);

  const displayMilestones = useMemo(() => {
    if (!simulateMode || proposedShifts.length === 0) return filteredMilestones;
    const shiftsMap = new Map(proposedShifts.map(s => [s.eventId, s]));
    return filteredMilestones.map(m => {
      const shift = shiftsMap.get(m.id);
      if (!shift) return m;
      const delta = daysBetween(new Date(m.startAt), new Date(shift.newStartAt));
      return { ...m, startAt: shift.newStartAt, endAt: m.endAt ? addDays(new Date(m.endAt), delta).toISOString() : null, _proposed: true };
    });
  }, [simulateMode, proposedShifts, filteredMilestones]);

  const activeEvent = useMemo(
    () => filteredMilestones.find(m => m.id === activeEventId) ?? null,
    [filteredMilestones, activeEventId]
  );

  const noteEvent = useMemo(
    () => filteredMilestones.find(m => m.id === noteEventId) ?? null,
    [filteredMilestones, noteEventId]
  );

  const canEditActiveEvent = canUpdate && (!activeEvent?.brandId || activeEvent.brandId === contextBrandId);

  const allBrands = brandsData?.items ?? [];
  const multiBrandAvailable = allBrands.length > 1;
  const brandColorMap = useMemo(() => assignBrandColors(allBrands), [allBrands]);

  const toggleBrand = (brandId: string) => {
    setSelectedBrandIds(prev => prev.includes(brandId) ? prev.filter(id => id !== brandId) : [...prev, brandId]);
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
        <Button size="sm" onClick={() => setCreateDate('')} disabled={!calendar}>
          <Plus size={14} className="mr-1" />Nuovo evento
        </Button>
      )}
      <div className="flex border rounded-md overflow-hidden">
        <Button variant={view === 'month' ? 'default' : 'ghost'} size="sm" className="rounded-none border-0" onClick={() => setView('month')} title="Mese"><CalendarDays size={14} /></Button>
        <Button variant={view === 'gantt' ? 'default' : 'ghost'} size="sm" className="rounded-none border-0" onClick={() => setView('gantt')} title="Gantt"><GanttChart size={14} /></Button>
        <Button variant={view === 'week' ? 'default' : 'ghost'} size="sm" className="rounded-none border-0" onClick={() => setView('week')} title="Settimana"><CalendarRange size={14} /></Button>
        <Button variant={view === 'day' ? 'default' : 'ghost'} size="sm" className="rounded-none border-0" onClick={() => setView('day')} title="Giorno"><CalendarClock size={14} /></Button>
        <Button variant={view === 'list' ? 'default' : 'ghost'} size="sm" className="rounded-none border-0" onClick={() => setView('list')} title="Lista"><List size={14} /></Button>
      </div>
      {canUpdate && (
        <Button
          variant={simulateMode ? 'destructive' : 'outline'}
          size="sm"
          onClick={() => simulateMode ? handleResetSimulate() : setSimulateMode(true)}
          disabled={!calendar}
          title="What-If"
        >
          <FlaskConical size={14} className="mr-1" />What-If
        </Button>
      )}
      <ExportButton seasonId={season?.id ?? ''} brandIds={selectedBrandIds} view={view} viewDate={viewDate} disabled={!season?.id} />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" title="Altre azioni"><MoreHorizontal size={14} /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {canUpdate && (
            <>
              <DropdownMenuItem onClick={() => setCloneOpen(true)} disabled={!calendar}>
                <Copy size={13} className="mr-2" />Clona da…
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setTemplateOpen(true)} disabled={!calendar}>
                Applica template
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}
          {canSync && (
            <DropdownMenuItem
              onClick={() => calendar && triggerSyncMutation.mutate({ calendarId: calendar.id })}
              disabled={!calendar || triggerSyncMutation.isPending}
            >
              <RefreshCw size={13} className={cn('mr-2', triggerSyncMutation.isPending && 'animate-spin')} />Sincronizza
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );

  const allFnsSelected = selectedFunctionIds.length === availableFunctions.length;
  const someFnsSelected = selectedFunctionIds.length > 0 && !allFnsSelected;

  const filterStrip = (
    <div className="flex items-center gap-3 mb-3 flex-wrap">
      {multiBrandAvailable && (
        <div className="flex items-center gap-1.5 flex-wrap">
          {allBrands.map(b => {
            const selected = selectedBrandIds.includes(b.id);
            const isActive = b.id === contextBrandId;
            return (
              <button
                key={b.id}
                type="button"
                onClick={() => toggleBrand(b.id)}
                className={cn(
                  'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs border transition-all',
                  selected
                    ? 'border-transparent text-white font-medium'
                    : 'border-border bg-background text-muted-foreground hover:text-foreground',
                  isActive && selected && 'ring-1 ring-offset-1 ring-primary/40',
                )}
                style={selected ? { background: resolveBrandColor(b.id, brandColorMap) } : undefined}
              >
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: selected ? 'rgba(255,255,255,0.6)' : resolveBrandColor(b.id, brandColorMap) }} />
                {b.name}
              </button>
            );
          })}
          <div className="w-px h-4 bg-border" />
        </div>
      )}

      {availableFunctions.length > 0 && (
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs">
              <span className={cn(someFnsSelected && 'text-primary font-medium')}>
                Visualizza
                {someFnsSelected
                  ? ` · ${selectedFunctionIds.length}/${availableFunctions.length}`
                  : allFnsSelected
                    ? ` · tutte`
                    : ''}
              </span>
              <ChevronDown size={12} className="text-muted-foreground" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-52 p-2">
            {!allFnsSelected && (
              <>
                <button
                  type="button"
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-muted-foreground hover:bg-muted transition-colors mb-1"
                  onClick={() => setSelectedFunctionIds(availableFunctions.map(f => f.id))}
                >
                  Seleziona tutte
                </button>
                <div className="border-t mb-1" />
              </>
            )}
            {availableFunctions.map(fn => {
              const checked = selectedFunctionIds.includes(fn.id);
              return (
                <button
                  key={fn.id}
                  type="button"
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm hover:bg-muted transition-colors"
                  onClick={() => setSelectedFunctionIds(prev =>
                    checked ? prev.filter(id => id !== fn.id) : [...prev, fn.id]
                  )}
                >
                  <Check size={12} className={cn('shrink-0 text-primary', !checked && 'opacity-0')} />
                  {fn.name}
                </button>
              );
            })}
          </PopoverContent>
        </Popover>
      )}

      {syncStatus && (
        <span className="text-xs text-muted-foreground ml-auto">
          {syncStatus.totalSynced} sincronizzati
          {syncStatus.lastSyncedAt && (
            <> · {new Date(syncStatus.lastSyncedAt).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</>
          )}
        </span>
      )}
    </div>
  );

  const eventTitleById = useMemo(() =>
    Object.fromEntries(filteredMilestones.map(m => [m.id, m.title])),
    [filteredMilestones]
  );

  const calendarBody = (
    <div>
      {filterStrip}
      {simulateMode && (
        <WhatIfBanner
          shiftCount={proposedShifts.length}
          violations={simulateResult?.violations ?? []}
          suggestion={simulateResult?.suggestion ?? null}
          loading={simulateMutation.isPending}
          onSimulate={handleSimulate}
          onApplySuggestion={handleApplySuggestion}
          onApply={() => void handleApplyShifts()}
          onReset={handleResetSimulate}
          eventTitleById={eventTitleById}
        />
      )}
      <Card>
        <CardContent className="p-0">
          {calendarLoading || milestonesLoading ? (
            <div className="py-12 text-center text-muted-foreground">Caricamento…</div>
          ) : view === 'week' ? (
            <CalendarEventWeekView
              milestones={displayMilestones}
              viewDate={viewDate}
              onViewDateChange={setViewDate}
              onEventClick={id => setActiveEventId(id)}
              onNoteClick={id => setNoteEventId(id)}
              onEventUpdate={handleEventUpdate}
              onDayClick={onDayClickProp}
              onDayNumberClick={handleDayNumberClick}
              activeBrandId={contextBrandId ?? undefined}
              canUpdate={canUpdate}
              brandColorMap={brandColorMap}
              holidayDates={holidayDates}
            />
          ) : view === 'month' ? (
            <CalendarEventMonthView
              milestones={displayMilestones}
              viewDate={viewDate}
              onViewDateChange={setViewDate}
              onEventClick={id => setActiveEventId(id)}
              onNoteClick={id => setNoteEventId(id)}
              onEventUpdate={handleEventUpdate}
              onDayClick={onDayClickProp}
              onDayNumberClick={handleDayNumberClick}
              onWeekNumberClick={handleWeekNumberClick}
              activeBrandId={contextBrandId ?? undefined}
              canUpdate={canUpdate}
              brandColorMap={brandColorMap}
              holidayDates={holidayDates}
            />
          ) : view === 'day' ? (
            <CalendarEventDayView
              milestones={displayMilestones}
              viewDate={viewDate}
              onViewDateChange={setViewDate}
              onEventClick={id => setActiveEventId(id)}
              onNoteClick={id => setNoteEventId(id)}
              onEventUpdate={handleEventUpdate}
              onDayClick={onDayClickTimedProp}
              activeBrandId={contextBrandId ?? undefined}
              canUpdate={canUpdate}
              brandColorMap={brandColorMap}
            />
          ) : displayMilestones.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              <Calendar size={32} className="mx-auto mb-2 opacity-40" />
              <p>Nessun evento per i filtri selezionati</p>
              {canUpdate && calendar && (
                <Button variant="outline" size="sm" className="mt-3" onClick={() => setCreateDate('')}>
                  <Plus size={14} className="mr-1" />Crea il primo evento
                </Button>
              )}
            </div>
          ) : view === 'gantt' ? (
            <CalendarEventGantt
              milestones={displayMilestones}
              onEventClick={id => setActiveEventId(id)}
              onNoteClick={id => setNoteEventId(id)}
              onEventUpdate={handleEventUpdate}
              onDayClick={onDayClickProp}
              activeBrandId={contextBrandId ?? undefined}
              functionsById={functionsById}
              canUpdate={canUpdate}
              brandColorMap={brandColorMap}
              holidayDates={holidayDates}
            />
          ) : (
            <CalendarEventTimeline
              milestones={displayMilestones}
              onEventClick={id => setActiveEventId(id)}
              onNoteClick={id => setNoteEventId(id)}
              onDayClick={onDayClickProp}
              onBulkDelete={ids => deleteEventsMutation.mutate({ ids })}
              activeBrandId={contextBrandId ?? undefined}
              functionsById={functionsById}
              canUpdate={canUpdate}
              brandColorMap={brandColorMap}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );

  return (
    <>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold whitespace-nowrap">Calendario Stagionale</h1>
          {season && <p className="text-muted-foreground mt-1">{season.name}{season.year ? ` · ${season.year}` : ''}</p>}
        </div>
        <div className="flex gap-2 items-center">
          {actionBar}
          <Button variant="outline" size="sm" onClick={() => setIsFullscreen(true)} title="Espandi"><Maximize2 size={14} /></Button>
        </div>
      </div>

      {!isFullscreen && calendarBody}

      {isFullscreen && createPortal(
        <div className="fixed inset-0 z-50 bg-background flex flex-col">
          <div className="shrink-0 border-b px-6 py-3 flex items-center justify-between bg-card">
            <div className="flex items-center gap-3">
              <span className="font-semibold text-sm">Calendario Stagionale</span>
              {season && <span className="text-sm text-muted-foreground">{season.name}{season.year ? ` · ${season.year}` : ''}</span>}
            </div>
            <div className="flex gap-2 items-center">
              {actionBar}
              <Button variant="ghost" size="sm" onClick={() => setIsFullscreen(false)} title="Riduci"><Minimize2 size={14} /></Button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-6">{calendarBody}</div>
        </div>,
        document.body
      )}

      {/* Event detail / edit dialog */}
      {activeEvent && (
        <CalendarEventDialog
          open={!!activeEventId}
          onClose={() => setActiveEventId(null)}
          onSaved={() => void refetch()}
          onDeleted={() => { setActiveEventId(null); void refetch(); }}
          calendarId={calendar?.id ?? ''}
          availableFunctions={availableFunctions}
          functionsById={functionsById}
          event={activeEvent}
          readOnly={!canEditActiveEvent}
          allEvents={filteredMilestones}
        />
      )}

      {/* Create dialog */}
      {calendar && createDate !== null && (
        <CalendarEventDialog
          open
          onClose={() => { setCreateDate(null); setCreateDefaultAllDay(true); }}
          onSaved={() => { setCreateDate(null); setCreateDefaultAllDay(true); void refetch(); }}
          calendarId={calendar.id}
          availableFunctions={availableFunctions}
          functionsById={functionsById}
          defaultDate={createDate || undefined}
          defaultAllDay={createDefaultAllDay}
        />
      )}

      {/* Personal note dialog */}
      {noteEvent && (
        <CalendarEventNoteDialog
          open={!!noteEventId}
          onClose={() => setNoteEventId(null)}
          eventId={noteEvent.id}
          eventTitle={noteEvent.title}
          initialNote={noteEvent.notes?.[0]?.body ?? ''}
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
