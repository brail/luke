'use client';

import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import React, { useEffect, useState } from 'react';

import { SectionCard } from '../../../../components/SectionCard';
import { Badge } from '../../../../components/ui/badge';
import { Button } from '../../../../components/ui/button';
import { Checkbox } from '../../../../components/ui/checkbox';
import { Input } from '../../../../components/ui/input';
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
import { useToast } from '../../../../hooks/use-toast';
import { trpc } from '../../../../lib/trpc';

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

// ── Mode note ─────────────────────────────────────────────────────────────────

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
  const toast = useToast();

  // ── Filter query ───────────────────────────────────────────────────────────
  const filterQuery = trpc.integrations.nav.sync.getFilter.useQuery(
    { entity },
    { refetchOnWindowFocus: false },
  );

  // ── Preview: lazy — mai auto-eseguita ─────────────────────────────────────
  // Viene caricata solo se l'utente preme "Carica anteprima"
  // ed è visibile solo quando mode è whitelist o exclude.
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
    onError: (err: any) => toast.error('Errore salvataggio filtro', { description: err.message }),
  });

  const saveSyncScheduleMutation = trpc.integrations.nav.sync.saveSyncSchedule.useMutation({
    onSuccess: () => {
      toast.success('Pianificazione salvata');
      void filterQuery.refetch();
    },
    onError: (err: any) => toast.error('Errore salvataggio pianificazione', { description: err.message }),
  });

  const runSyncMutation = trpc.integrations.nav.sync.run.useMutation({
    onError: (err: any) => toast.error('Sync fallito', { description: err.message }),
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

  // Inizializza selezione, mode e pianificazione dal filtro salvato
  useEffect(() => {
    if (filterQuery.isSuccess) {
      if (filterQuery.data) {
        setMode(filterQuery.data.mode as SyncMode);
        setSelectedNavNos(new Set(filterQuery.data.navNos));
        setAutoSyncEnabled(filterQuery.data.autoSyncEnabled ?? false);
        setIntervalMinutes(filterQuery.data.intervalMinutes ?? 30);
      } else {
        setMode(null);
        setAutoSyncEnabled(false);
        setIntervalMinutes(30);
      }
    }
  }, [filterQuery.isSuccess, filterQuery.data]);

  // Resetta la preview quando il mode cambia
  useEffect(() => {
    setTextFilter('');
    setCurrentPage(1);
    setShowOnlySelected(false);
  }, [mode]);

  const isNotConfigured = filterQuery.isSuccess && !filterQuery.data;

  // Resetta la pagina quando cambia il filtro testuale
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

  // Il checkbox header opera su tutti i filtrati (non solo la pagina corrente)
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
      {/* ── Pannello filtro ──────────────────────────────────────────────── */}
      <SectionCard
        title="Criterio di sincronizzazione"
        description="Definisci quali record NAV vengono inclusi nel sync"
      >
        <div className="space-y-4">
          {/* Warning: nessun criterio configurato */}
          {isNotConfigured && (
            <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-400">
              ⚠️ Nessun criterio configurato — il sync è bloccato finché non selezioni e salvi un&apos;opzione.
            </p>
          )}

          {/* Badge contatore — solo quando c'è una selezione attiva */}
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
            {/* Colonna sinistra: filtro */}
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

            {/* Colonna destra: modalità sync */}
            <div className="space-y-3">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Modalità sync</p>
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div className="space-y-0.5">
                  <p className="text-sm font-medium">Automatica</p>
                  <p className="text-xs text-muted-foreground">
                    {autoSyncEnabled ? `Ogni ${intervalMinutes} min` : 'Solo manuale'}
                  </p>
                </div>
                <Switch
                  checked={autoSyncEnabled}
                  onCheckedChange={setAutoSyncEnabled}
                />
              </div>

              {autoSyncEnabled && (
                <div className="flex items-center gap-2">
                  <label className="text-sm whitespace-nowrap">Ogni</label>
                  <Input
                    type="number"
                    min={1}
                    max={1440}
                    value={intervalMinutes}
                    onChange={e => setIntervalMinutes(Math.max(1, parseInt(e.target.value) || 30))}
                    className="w-20"
                  />
                  <span className="text-sm text-muted-foreground">minuti</span>
                </div>
              )}
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
      </SectionCard>

      {/* ── Anteprima selezione (solo whitelist / exclude) ────────────────── */}
      {showPreview && (
        <SectionCard
          title={`Selezione ${entityLabel}`}
          description={`Seleziona i record da ${mode === 'whitelist' ? 'includere' : 'escludere'} dal sync. Carica l'anteprima da NAV per modificare la selezione.`}
        >
          <div className="space-y-4">
            {/* Bottone carica + filtro testuale */}
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

            {/* Tabella — visibile solo dopo aver caricato */}
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
                      size="icon"
                      className="h-7 w-7"
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
                      size="icon"
                      className="h-7 w-7"
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

      {/* ── Esecuzione sync manuale ────────────────────────────────────────── */}
      <SectionCard
        title={`Esegui sync ${entityLabel}`}
        description={`Avvia manualmente la sincronizzazione NAV → DB locale per i soli ${entityLabel.toLowerCase()}`}
      >
        <div className="space-y-3">
          {/* Banner avviso criterio non configurato */}
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
            <p className="text-sm text-destructive">{runSyncMutation.error.message}</p>
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
        </TabsList>

        {ENTITY_TABS.map(tab => (
          <TabsContent key={tab.id} value={tab.id} className="mt-4">
            <NavSyncTab entity={tab.id} entityLabel={tab.label} />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
