'use client';

import { ChevronLeft, ChevronRight, LoaderCircle, RefreshCw } from 'lucide-react';
import React, { useEffect, useId, useState } from 'react';
import { toast } from 'sonner';

import { SectionCard } from '../../../../components/SectionCard';
import { SettingsFormGate } from '../../../../components/settings/SettingsFormShell';
import { Badge } from '../../../../components/ui/badge';
import { Button } from '../../../../components/ui/button';
import { Checkbox } from '../../../../components/ui/checkbox';
import { Input } from '../../../../components/ui/input';
import { Label } from '../../../../components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../../components/ui/select';
import { Skeleton } from '../../../../components/ui/skeleton';
import { Switch } from '../../../../components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../../components/ui/table';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '../../../../components/ui/tabs';
import { formatRelativeTime } from '../../../../lib/relativeTime';
import { trpc } from '../../../../lib/trpc';
import { getTrpcErrorMessage } from '../../../../lib/trpcErrorMessages';
import { cn } from '../../../../lib/utils';

// ── Types ─────────────────────────────────────────────────────────────────────

type SyncMode = 'all' | 'whitelist' | 'exclude';
type EntityId = 'vendor' | 'brand' | 'season';

interface PreviewRecord {
  navNo: string;
  name: string;
  city: string | null;
  countryCode: string | null;
  blocked: number;
}

interface SyncResultItem {
  entity: string;
  upserted: number;
  skipped: boolean;
  filterMode: string;
  durationMs: number;
}

interface SyncRunResult {
  results: SyncResultItem[];
}

const PAGE_SIZE_OPTIONS = [25, 50, 100, 200] as const;
type PageSize = (typeof PAGE_SIZE_OPTIONS)[number];

const ENTITY_TABS: { id: EntityId; label: string }[] = [
  { id: 'vendor', label: 'Fornitori' },
  { id: 'brand', label: 'Brand' },
  { id: 'season', label: 'Stagioni' },
];

// ── Sync schedule ─────────────────────────────────────────────────────────────

/** The automatic-sync switch and, while it is on, the interval in minutes. */
function ScheduleFields({
  autoSyncEnabled,
  onAutoSyncChange,
  intervalMinutes,
  onIntervalChange,
  defaultIntervalMinutes,
}: {
  autoSyncEnabled: boolean;
  onAutoSyncChange: (enabled: boolean) => void;
  intervalMinutes: number;
  onIntervalChange: (minutes: number) => void;
  defaultIntervalMinutes: number;
}) {
  const intervalId = useId();
  return (
    <>
      <div className="flex items-center justify-between rounded-lg border p-3">
        <div className="space-y-0.5">
          <p className="text-sm font-medium">Automatica</p>
          <p className="text-xs text-muted-foreground">
            {autoSyncEnabled ? `Ogni ${intervalMinutes} min` : 'Solo manuale'}
          </p>
        </div>
        <Switch
          checked={autoSyncEnabled}
          onCheckedChange={onAutoSyncChange}
        />
      </div>

      {autoSyncEnabled && (
        <div className="flex items-center gap-2">
          <Label htmlFor={intervalId} className="whitespace-nowrap font-normal">Ogni</Label>
          <Input
            id={intervalId}
            type="number"
            min={1}
            max={1440}
            value={intervalMinutes}
            onChange={e => onIntervalChange(Math.max(1, parseInt(e.target.value) || defaultIntervalMinutes))}
            className="w-20"
          />
          <span className="text-sm text-muted-foreground">minuti</span>
        </div>
      )}
    </>
  );
}

/** Auto-sync schedule of a NAV table set (Portafoglio, KIMO), editable only once the stored schedule has been read. */
function SyncScheduleCard({
  entity,
  description,
  defaultIntervalMinutes,
}: {
  entity: 'portafoglio' | 'kimo';
  description: string;
  defaultIntervalMinutes: number;
}) {
  const filterQuery = trpc.integrations.nav.sync.getFilter.useQuery({ entity });

  const [autoSyncEnabled, setAutoSyncEnabled] = useState(false);
  const [intervalMinutes, setIntervalMinutes] = useState(defaultIntervalMinutes);

  // Keyed on `data` alone: a refetch that returns the same filter keeps its reference (structural
  // sharing), so a failed refetch that recovers does not discard unsaved edits.
  useEffect(() => {
    if (filterQuery.data) {
      setAutoSyncEnabled(filterQuery.data.autoSyncEnabled ?? false);
      setIntervalMinutes(filterQuery.data.intervalMinutes ?? defaultIntervalMinutes);
    }
  }, [filterQuery.data, defaultIntervalMinutes]);

  const saveSyncScheduleMutation = trpc.integrations.nav.sync.saveSyncSchedule.useMutation({
    onSuccess: () => {
      toast.success('Pianificazione salvata');
      void filterQuery.refetch();
    },
    onError: err => toast.error('Errore salvataggio pianificazione', { description: getTrpcErrorMessage(err) }),
  });

  return (
    <SectionCard title="Pianificazione sync automatico" description={description}>
      <SettingsFormGate
        isPending={filterQuery.isPending}
        error={filterQuery.error}
        hasData={filterQuery.data !== undefined}
        onRetry={() => void filterQuery.refetch()}
      >
        <div className="space-y-4">
          <ScheduleFields
            autoSyncEnabled={autoSyncEnabled}
            onAutoSyncChange={setAutoSyncEnabled}
            intervalMinutes={intervalMinutes}
            onIntervalChange={setIntervalMinutes}
            defaultIntervalMinutes={defaultIntervalMinutes}
          />

          <Button
            size="sm"
            onClick={() => saveSyncScheduleMutation.mutate({ entity, autoSyncEnabled, intervalMinutes })}
            disabled={saveSyncScheduleMutation.isPending}
          >
            {saveSyncScheduleMutation.isPending ? 'Salvataggio…' : 'Salva configurazione'}
          </Button>
        </div>
      </SettingsFormGate>
    </SectionCard>
  );
}

// ── Portafoglio Vendite tab ────────────────────────────────────────────────────

function PortafoglioSyncTab() {

  const { data: syncState, refetch: refetchSyncState } =
    trpc.sales.statistics.portafoglio.getSyncState.useQuery(undefined, {
      refetchInterval: 30_000, // SSE push handles real-time, this is just fallback
    });

  const syncMutation = trpc.sales.statistics.portafoglio.triggerSync.useMutation({
    onSuccess: result => {
      void refetchSyncState();
      const secs = (result.totalDurationMs / 1000).toFixed(1);
      const totalRows = result.stats.reduce((s, x) => s + x.rowsUpserted, 0);
      toast.success(`Sync completato — ${totalRows.toLocaleString('it-IT')} righe in ${secs} s`);
    },
    onError: err => toast.error('Errore sync portafoglio', { description: getTrpcErrorMessage(err) }),
  });

  const isSyncing = syncMutation.isPending || (syncState?.isRunning ?? false);

  return (
    <div className="space-y-6">
      <SyncScheduleCard
        entity="portafoglio"
        description="Configura la frequenza di sincronizzazione automatica NAV → PostgreSQL per il portafoglio ordini."
        defaultIntervalMinutes={5}
      />

      <SectionCard
        title="Sincronizzazione portafoglio ordini"
        description="Replica NAV → PostgreSQL delle tabelle del portafoglio."
      >
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              onClick={() => syncMutation.mutate()}
              disabled={isSyncing}
              className="gap-2"
            >
              {isSyncing ? (
                <>
                  <LoaderCircle size={16} className="animate-spin" />
                  Sincronizzazione…
                </>
              ) : (
                <>
                  <RefreshCw size={16} />
                  Aggiorna ora
                </>
              )}
            </Button>

            <LastSyncLabel syncState={syncState} tableName="nav_pf_sales_header" staleAfterMinutes={10} />
          </div>

          {syncState && syncState.tables.length > 0 && (
            <div className="rounded-md border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Tabella</th>
                    <th className="px-3 py-2 text-right font-medium text-muted-foreground">Righe</th>
                    <th className="px-3 py-2 text-right font-medium text-muted-foreground">Durata</th>
                    <th className="px-3 py-2 text-right font-medium text-muted-foreground">Ultimo sync</th>
                  </tr>
                </thead>
                <tbody>
                  {syncState.tables.map(t => (
                    <tr key={t.tableName} className="border-b last:border-0">
                      <td className="px-3 py-1.5 font-mono text-xs">{t.tableName}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{t.rowCount.toLocaleString('it-IT')}</td>
                      <td className="px-3 py-1.5 text-right text-muted-foreground tabular-nums">
                        {t.lastDurationMs != null ? `${(t.lastDurationMs / 1000).toFixed(1)} s` : '—'}
                      </td>
                      <td className="px-3 py-1.5 text-right text-muted-foreground">
                        {t.lastSyncedAt
                          ? new Date(t.lastSyncedAt).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' })
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </SectionCard>
    </div>
  );
}

// ── Kimo Sync tab ─────────────────────────────────────────────────────────────

function KimoSyncTab() {

  const { data: syncState, refetch: refetchSyncState } =
    trpc.sales.statistics.kimo.getSyncState.useQuery(undefined, {
      refetchInterval: 30_000, // SSE push handles real-time, this is just fallback
    });

  const syncMutation = trpc.sales.statistics.kimo.triggerSync.useMutation({
    onSuccess: result => {
      void refetchSyncState();
      const secs = (result.totalDurationMs / 1000).toFixed(1);
      const totalRows = result.stats.reduce((s, x) => s + x.rowsUpserted, 0);
      toast.success(`Sync completato — ${totalRows.toLocaleString('it-IT')} righe in ${secs} s`);
    },
    onError: err => toast.error('Errore sync KIMO', { description: getTrpcErrorMessage(err) }),
  });

  const isSyncing = syncMutation.isPending || (syncState?.isRunning ?? false);

  return (
    <div className="space-y-6">
      <SyncScheduleCard
        entity="kimo"
        description="Configura la frequenza di sincronizzazione automatica NAV → PostgreSQL per le tabelle KIMO-FASHION."
        defaultIntervalMinutes={30}
      />

      <SectionCard
        title="Sincronizzazione KIMO-FASHION"
        description="Replica NAV → PostgreSQL delle tabelle KIMO-FASHION Sales Order (Hdr, Line) e AssortimentiQuantita."
      >
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              onClick={() => syncMutation.mutate()}
              disabled={isSyncing}
              className="gap-2"
            >
              {isSyncing ? (
                <>
                  <LoaderCircle size={16} className="animate-spin" />
                  Sincronizzazione…
                </>
              ) : (
                <>
                  <RefreshCw size={16} />
                  Aggiorna ora
                </>
              )}
            </Button>

            <LastSyncLabel syncState={syncState} tableName="nav_kimo_sales_header" staleAfterMinutes={60} />
          </div>

          {syncState && syncState.tables.length > 0 && (
            <div className="rounded-md border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Tabella</th>
                    <th className="px-3 py-2 text-right font-medium text-muted-foreground">Righe</th>
                    <th className="px-3 py-2 text-right font-medium text-muted-foreground">Durata</th>
                    <th className="px-3 py-2 text-right font-medium text-muted-foreground">Ultimo sync</th>
                  </tr>
                </thead>
                <tbody>
                  {syncState.tables.map(t => (
                    <tr key={t.tableName} className="border-b last:border-0">
                      <td className="px-3 py-1.5 font-mono text-xs">{t.tableName}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{t.rowCount.toLocaleString('it-IT')}</td>
                      <td className="px-3 py-1.5 text-right text-muted-foreground tabular-nums">
                        {t.lastDurationMs != null ? `${(t.lastDurationMs / 1000).toFixed(1)} s` : '—'}
                      </td>
                      <td className="px-3 py-1.5 text-right text-muted-foreground">
                        {t.lastSyncedAt
                          ? new Date(t.lastSyncedAt).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' })
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {syncState && syncState.tables.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nessun dato di sync disponibile. Avvia il primo sync manualmente.
            </p>
          )}
        </div>
      </SectionCard>
    </div>
  );
}

// ── Mode note ─────────────────────────────────────────────────────────────────

/** Whole minutes since `date`, rounded down like the "Ultimo sync" label. */
function minutesSince(date: Date | string): number {
  return Math.floor((Date.now() - new Date(date).getTime()) / 60_000);
}

/** "Ultimo sync" of a NAV sync tab, with a warning once the header table is older than `staleAfterMinutes`. */
function LastSyncLabel({
  syncState,
  tableName,
  staleAfterMinutes,
}: {
  syncState: { isRunning: boolean; tables: { tableName: string; lastSyncedAt: Date | string | null }[] } | null | undefined;
  tableName: string;
  staleAfterMinutes: number;
}) {
  const lastSyncedAt = syncState?.tables.find(t => t.tableName === tableName)?.lastSyncedAt;
  if (!lastSyncedAt || syncState?.isRunning) return null;
  const isStale = minutesSince(lastSyncedAt) > staleAfterMinutes;
  return (
    <span className={cn('text-sm', isStale ? 'text-amber-500' : 'text-muted-foreground')}>
      Ultimo sync: {formatRelativeTime(lastSyncedAt)}
      {isStale && ' ⚠︎'}
    </span>
  );
}

function ModeNote({ mode, entityLabel }: { mode: SyncMode; entityLabel: string }) {
  if (mode === 'all') return null;

  if (mode === 'whitelist') {
    return (
      <p className="mt-2 text-sm text-amber-600 dark:text-amber-400">
        ⚠️ I nuovi {entityLabel.toLowerCase()} aggiunti su NAV non verranno
        sincronizzati automaticamente. Torna qui per aggiungerli alla selezione.
      </p>
    );
  }

  return (
    <p className="mt-2 text-sm text-blue-600 dark:text-blue-400">
      ℹ️ I nuovi {entityLabel.toLowerCase()} aggiunti su NAV verranno
      sincronizzati automaticamente, a meno che tu non li escluda esplicitamente.
    </p>
  );
}

// ── Tab content ───────────────────────────────────────────────────────────────

function NavSyncTab({
  entity,
  entityLabel,
}: {
  entity: EntityId;
  entityLabel: string;
}) {

  // ── Filter query ───────────────────────────────────────────────────────────
  const filterQuery = trpc.integrations.nav.sync.getFilter.useQuery({ entity });

  // ── Preview: lazy — never auto-executed ───────────────────────────────────
  // Loads only when user presses "Load preview"
  // and is visible only when mode is whitelist or exclude.
  const previewQuery = trpc.integrations.nav.sync.preview.useQuery(
    { entity },
    { enabled: false, retry: 1 },
  );

  // ── Mutations ──────────────────────────────────────────────────────────────
  const saveFilterMutation = trpc.integrations.nav.sync.saveFilter.useMutation({
    onSuccess: () => {
      toast.success('Filtro salvato');
      void filterQuery.refetch();
    },
    onError: err => toast.error('Errore salvataggio filtro', { description: getTrpcErrorMessage(err) }),
  });

  const saveSyncScheduleMutation = trpc.integrations.nav.sync.saveSyncSchedule.useMutation({
    onSuccess: () => {
      toast.success('Pianificazione salvata');
      void filterQuery.refetch();
    },
    onError: err => toast.error('Errore salvataggio pianificazione', { description: getTrpcErrorMessage(err) }),
  });

  const runSyncMutation = trpc.integrations.nav.sync.run.useMutation({
    onError: err => toast.error('Sync fallito', { description: getTrpcErrorMessage(err) }),
  });

  // ── Local state ────────────────────────────────────────────────────────────
  const [textFilter, setTextFilter] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(25);
  const [selectedNavNos, setSelectedNavNos] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<SyncMode | null>(null);
  const [syncRunResult, setSyncRunResult] = useState<SyncRunResult | null>(null);
  const [showOnlySelected, setShowOnlySelected] = useState(false);

  // Pianificazione sync
  const [autoSyncEnabled, setAutoSyncEnabled] = useState(false);
  const [intervalMinutes, setIntervalMinutes] = useState(30);

  // Initialize selection, mode and schedule from the saved filter. Keyed on `data` alone, as in
  // SyncScheduleCard: a recovered failed refetch keeps unsaved edits.
  useEffect(() => {
    const saved = filterQuery.data;
    if (!saved) return;
    setMode(saved.mode as SyncMode);
    setSelectedNavNos(new Set(saved.navNos));
    setAutoSyncEnabled(saved.autoSyncEnabled ?? false);
    setIntervalMinutes(saved.intervalMinutes ?? 30);
  }, [filterQuery.data]);

  // Reset preview when mode changes
  useEffect(() => {
    setTextFilter('');
    setCurrentPage(1);
    setShowOnlySelected(false);
  }, [mode]);

  const isNotConfigured = filterQuery.data === null;

  // Reset page when text filter changes
  useEffect(() => {
    setCurrentPage(1);
  }, [textFilter]);

  // ── Derived state ──────────────────────────────────────────────────────────
  const showPreview = mode === 'whitelist' || mode === 'exclude';
  const allRecords: PreviewRecord[] = previewQuery.data ?? [];

  const filteredRecords = (() => {
    let records = allRecords;
    if (showOnlySelected) records = records.filter(r => selectedNavNos.has(r.navNo));
    if (textFilter.trim()) {
      const q = textFilter.toLowerCase();
      records = records.filter(r => r.name.toLowerCase().includes(q));
    }
    return records;
  })();

  const totalPages = Math.max(1, Math.ceil(filteredRecords.length / pageSize));
  const paginatedRecords = filteredRecords.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  // The header checkbox acts on every filtered row (not just the current page)
  const allVisibleSelected =
    filteredRecords.length > 0 && filteredRecords.every(r => selectedNavNos.has(r.navNo));
  const someVisibleSelected = filteredRecords.some(r => selectedNavNos.has(r.navNo));
  const headerCheckState: boolean | 'indeterminate' = allVisibleSelected
    ? true
    : someVisibleSelected
      ? 'indeterminate'
      : false;

  // ── Handlers ──────────────────────────────────────────────────────────────
  const toggleAll = () => {
    setSelectedNavNos(prev => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        filteredRecords.forEach(r => next.delete(r.navNo));
      } else {
        filteredRecords.forEach(r => next.add(r.navNo));
      }
      return next;
    });
  };

  const toggleRow = (navNo: string) => {
    setSelectedNavNos(prev => {
      const next = new Set(prev);
      if (next.has(navNo)) next.delete(navNo);
      else next.add(navNo);
      return next;
    });
  };

  const handleSaveFilter = () => {
    if (!mode) return;
    saveFilterMutation.mutate(
      { entity, mode, navNos: mode === 'all' ? [] : [...selectedNavNos] },
      {
        onSuccess: () => {
          saveSyncScheduleMutation.mutate({ entity, autoSyncEnabled, intervalMinutes });
        },
      }
    );
  };

  const handleRunSync = () => {
    setSyncRunResult(null);
    runSyncMutation.mutate({ entity }, {
      onSuccess: data => {
        setSyncRunResult(data);
        toast.success(`Sync ${entityLabel} completato`);
      },
    });
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* ── Filter panel ─────────────────────────────────────────────────── */}
      <SectionCard
        title="Criterio di sincronizzazione"
        description="Definisci quali record NAV vengono inclusi nel sync"
      >
        <SettingsFormGate
          isPending={filterQuery.isPending}
          error={filterQuery.error}
          hasData={filterQuery.data !== undefined}
          onRetry={() => void filterQuery.refetch()}
        >
          <div className="space-y-4">
            {/* Warning: no criterion configured */}
            {isNotConfigured && (
              <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-400">
                ⚠️ Nessun criterio configurato — il sync è bloccato finché non selezioni e salvi un&apos;opzione.
              </p>
            )}

            {/* Counter badge — only when a selection is active */}
            {showPreview && selectedNavNos.size > 0 && (
              <Badge variant="secondary" className="text-sm">
                {selectedNavNos.size} {entityLabel.toLowerCase()} selezionati
                {filterQuery.data?.updatedAt && (
                  <span className="ml-2 text-xs text-muted-foreground">
                    — salvato {new Date(filterQuery.data.updatedAt).toLocaleString('it-IT')}
                  </span>
                )}
              </Badge>
            )}

            {/* Radio mode + pianificazione — layout a due colonne */}
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
              {/* Left column: filter */}
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Filtro record</p>
                {(
                  [
                    { value: 'all', label: 'Sincronizza tutti' },
                    { value: 'whitelist', label: 'Solo selezionati' },
                    { value: 'exclude', label: 'Escludi selezionati' },
                  ] as const
                ).map(opt => (
                  <label key={opt.value} className="flex cursor-pointer items-center gap-2">
                    <input
                      type="radio"
                      name={`sync-mode-${entity}`}
                      value={opt.value}
                      checked={mode === opt.value}
                      onChange={() => setMode(opt.value)}
                      className="accent-primary h-4 w-4"
                    />
                    <span className="text-sm">{opt.label}</span>
                  </label>
                ))}
                {mode && <ModeNote mode={mode} entityLabel={entityLabel} />}
              </div>

              {/* Right column: sync mode */}
              <div className="space-y-3">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Modalità sync</p>
                <ScheduleFields
                  autoSyncEnabled={autoSyncEnabled}
                  onAutoSyncChange={setAutoSyncEnabled}
                  intervalMinutes={intervalMinutes}
                  onIntervalChange={setIntervalMinutes}
                  defaultIntervalMinutes={30}
                />
              </div>
            </div>

            <Button
              onClick={handleSaveFilter}
              disabled={saveFilterMutation.isPending || saveSyncScheduleMutation.isPending || mode === null}
              size="sm"
            >
              {saveFilterMutation.isPending || saveSyncScheduleMutation.isPending ? 'Salvataggio…' : 'Salva configurazione'}
            </Button>
          </div>
        </SettingsFormGate>
      </SectionCard>

      {/* ── Selection preview (whitelist / exclude only) ──────────────────── */}
      {showPreview && (
        <SectionCard
          title={`Selezione ${entityLabel}`}
          description={`Seleziona i record da ${mode === 'whitelist' ? 'includere' : 'escludere'} dal sync. Carica l'anteprima da NAV per modificare la selezione.`}
        >
          <div className="space-y-4">
            {/* Load button + text filter */}
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void previewQuery.refetch()}
                disabled={previewQuery.isFetching}
                className="gap-2"
              >
                <RefreshCw size={14} className={previewQuery.isFetching ? 'animate-spin' : ''} />
                {previewQuery.data ? 'Aggiorna da NAV' : 'Carica da NAV'}
              </Button>

              {previewQuery.data && (
                <>
                  <Button
                    variant={showOnlySelected ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => { setShowOnlySelected(v => !v); setCurrentPage(1); }}
                    className="gap-1.5 shrink-0"
                  >
                    {showOnlySelected ? `Selezionati (${selectedNavNos.size})` : `Mostra selezionati (${selectedNavNos.size})`}
                  </Button>
                  <Input
                    placeholder="Cerca per nome…"
                    value={textFilter}
                    onChange={e => setTextFilter(e.target.value)}
                    className="max-w-xs"
                  />
                  <Select
                    value={String(pageSize)}
                    onValueChange={val => {
                      setPageSize(Number(val) as PageSize);
                      setCurrentPage(1);
                    }}
                  >
                    <SelectTrigger className="w-24">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PAGE_SIZE_OPTIONS.map(n => (
                        <SelectItem key={n} value={String(n)}>
                          {n} righe
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </>
              )}

              {previewQuery.isError && (
                <span className="text-sm text-destructive">
                  {previewQuery.error.message}
                </span>
              )}
            </div>

            {/* Table — visible only after loading */}
            {(previewQuery.data || previewQuery.isFetching) && (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">
                        <Checkbox
                          checked={headerCheckState}
                          onCheckedChange={toggleAll}
                          disabled={previewQuery.isLoading || filteredRecords.length === 0}
                          aria-label="Seleziona/deseleziona tutti"
                        />
                      </TableHead>
                      <TableHead className="w-28">Codice</TableHead>
                      <TableHead>Nome / Descrizione</TableHead>
                      {entity === 'vendor' && <TableHead className="w-36">Città</TableHead>}
                      {entity === 'vendor' && <TableHead className="w-24">Paese</TableHead>}
                      {entity === 'vendor' && <TableHead className="w-24 text-center">Bloccato</TableHead>}
                      {entity === 'season' && <TableHead className="w-28">Inizio</TableHead>}
                      {entity === 'season' && <TableHead className="w-28">Fine</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {previewQuery.isFetching ? (
                      Array.from({ length: 6 }).map((_, i) => (
                        <TableRow key={i}>
                          {Array.from({ length: entity === 'brand' ? 3 : entity === 'season' ? 5 : 7 }).map((__, j) => (
                            <TableCell key={j}>
                              <Skeleton className="h-4 w-full" />
                            </TableCell>
                          ))}
                        </TableRow>
                      ))
                    ) : filteredRecords.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={entity === 'brand' ? 3 : entity === 'season' ? 5 : 7}
                          className="py-8 text-center text-muted-foreground"
                        >
                          {textFilter ? 'Nessun risultato per il filtro applicato.' : 'Nessun record trovato.'}
                        </TableCell>
                      </TableRow>
                    ) : (
                      paginatedRecords.map(row => (
                        <TableRow
                          key={row.navNo}
                          data-state={selectedNavNos.has(row.navNo) ? 'selected' : undefined}
                          className="cursor-pointer"
                          onClick={() => toggleRow(row.navNo)}
                        >
                          <TableCell onClick={e => e.stopPropagation()}>
                            <Checkbox
                              checked={selectedNavNos.has(row.navNo)}
                              onCheckedChange={() => toggleRow(row.navNo)}
                              aria-label={`Seleziona ${row.navNo}`}
                            />
                          </TableCell>
                          <TableCell className="font-mono text-xs">{row.navNo}</TableCell>
                          <TableCell className="font-medium">{row.name}</TableCell>
                          {entity === 'vendor' && (
                            <TableCell className="text-muted-foreground">{row.city ?? '—'}</TableCell>
                          )}
                          {entity === 'vendor' && (
                            <TableCell className="text-muted-foreground">{row.countryCode ?? '—'}</TableCell>
                          )}
                          {entity === 'vendor' && (
                            <TableCell className="text-center">
                              {row.blocked !== 0 ? (
                                <Badge variant="destructive" className="text-xs">
                                  {row.blocked === 1 ? 'Pagamento' : 'Tutto'}
                                </Badge>
                              ) : null}
                            </TableCell>
                          )}
                          {entity === 'season' && (
                            <TableCell className="text-muted-foreground text-xs">{row.city ?? '—'}</TableCell>
                          )}
                          {entity === 'season' && (
                            <TableCell className="text-muted-foreground text-xs">{row.countryCode ?? '—'}</TableCell>
                          )}
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            )}

            {previewQuery.data && filteredRecords.length > 0 && (
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  {filteredRecords.length === allRecords.length
                    ? `${allRecords.length} record totali da NAV`
                    : `${filteredRecords.length} di ${allRecords.length} (filtrati)`}
                </span>
                {totalPages > 1 && (
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="icon-sm"
                      onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                      disabled={currentPage === 1}
                      aria-label="Pagina precedente"
                    >
                      <ChevronLeft size={14} />
                    </Button>
                    <span>
                      {currentPage} / {totalPages}
                    </span>
                    <Button
                      variant="outline"
                      size="icon-sm"
                      onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                      disabled={currentPage === totalPages}
                      aria-label="Pagina successiva"
                    >
                      <ChevronRight size={14} />
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
        </SectionCard>
      )}

      {/* ── Manual sync run ────────────────────────────────────────────────── */}
      <SectionCard
        title={`Esegui sync ${entityLabel}`}
        description={`Avvia manualmente la sincronizzazione NAV → DB locale per i soli ${entityLabel.toLowerCase()}`}
      >
        <div className="space-y-3">
          {/* Unconfigured criterion warning banner */}
          {isNotConfigured && (
            <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">
              ⚠️ Configura e salva un criterio di sincronizzazione prima di eseguire il sync.
            </p>
          )}

          <Button
            onClick={handleRunSync}
            disabled={runSyncMutation.isPending || isNotConfigured}
            className="gap-2"
          >
            <RefreshCw size={16} className={runSyncMutation.isPending ? 'animate-spin' : ''} />
            {runSyncMutation.isPending ? 'Sincronizzazione in corso…' : `Sync ${entityLabel} ora`}
          </Button>

          {syncRunResult && !runSyncMutation.isPending && (() => {
            const r = syncRunResult.results[0];
            if (!r) return null;
            if (!r.skipped) {
              return (
                <p className="text-sm text-green-600 dark:text-green-400">
                  ✓ {r.upserted} record sincronizzati in {(r.durationMs / 1000).toFixed(1)}s
                </p>
              );
            }
            const skipMsg =
              r.filterMode === 'not_configured'
                ? 'Sync saltato — criterio non ancora configurato'
                : r.filterMode === 'disabled'
                  ? 'Sync saltato — entità disabilitata'
                  : 'Sync saltato — whitelist vuota';
            return (
              <p className="text-sm text-amber-600 dark:text-amber-400">⚠️ {skipMsg}</p>
            );
          })()}

          {runSyncMutation.isError && (
            <p className="text-sm text-destructive">{getTrpcErrorMessage(runSyncMutation.error)}</p>
          )}
        </div>
      </SectionCard>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function NavSyncPage() {
  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Sincronizzazione NAV</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Gestisci la sincronizzazione dati da Microsoft Dynamics NAV verso il
          database locale
        </p>
      </div>

      <Tabs defaultValue="vendor">
        <TabsList>
          {ENTITY_TABS.map(tab => (
            <TabsTrigger key={tab.id} value={tab.id}>
              {tab.label}
            </TabsTrigger>
          ))}
          <TabsTrigger value="portafoglio">Portafoglio Vendite</TabsTrigger>
          <TabsTrigger value="kimo">KIMO-FASHION</TabsTrigger>
        </TabsList>

        {ENTITY_TABS.map(tab => (
          <TabsContent key={tab.id} value={tab.id} className="mt-4">
            <NavSyncTab entity={tab.id} entityLabel={tab.label} />
          </TabsContent>
        ))}
        <TabsContent value="portafoglio" className="mt-4">
          <PortafoglioSyncTab />
        </TabsContent>
        <TabsContent value="kimo" className="mt-4">
          <KimoSyncTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
