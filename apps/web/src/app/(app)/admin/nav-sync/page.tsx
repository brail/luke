'use client';

import { RefreshCw } from 'lucide-react';
import React, { useEffect, useMemo, useState } from 'react';

import { SectionCard } from '../../../../components/SectionCard';
import { Badge } from '../../../../components/ui/badge';
import { Button } from '../../../../components/ui/button';
import { Checkbox } from '../../../../components/ui/checkbox';
import { Input } from '../../../../components/ui/input';
import { Skeleton } from '../../../../components/ui/skeleton';
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
  syncDisabled: boolean;
  results: SyncResultItem[];
}

const ENTITY_TABS = [
  { id: 'vendor' as const, label: 'Fornitori' },
] satisfies { id: 'vendor'; label: string }[];

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
  entity: 'vendor';
  entityLabel: string;
}) {
  const toast = useToast();

  // ── Preview query ──────────────────────────────────────────────────────────
  const previewQuery = trpc.integrations.nav.sync.preview.useQuery(
    { entity },
    { refetchOnWindowFocus: false, retry: 1 },
  );

  // ── Status query (syncEnabled) ─────────────────────────────────────────────
  const statusQuery = trpc.integrations.nav.sync.getStatus.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });

  // ── Filter query ───────────────────────────────────────────────────────────
  const filterQuery = trpc.integrations.nav.sync.getFilter.useQuery(
    { entity },
    { refetchOnWindowFocus: false },
  );

  // ── Mutations ──────────────────────────────────────────────────────────────
  const saveFilterMutation = trpc.integrations.nav.sync.saveFilter.useMutation({
    onSuccess: () => {
      toast.success('Filtro salvato');
      void filterQuery.refetch();
    },
    onError: (err: any) => toast.error('Errore salvataggio filtro', { description: err.message }),
  });

  const runSyncMutation = trpc.integrations.nav.sync.run.useMutation({
    onError: (err: any) => toast.error('Sync fallito', { description: err.message }),
  });

  // ── Local state ────────────────────────────────────────────────────────────
  const [textFilter, setTextFilter] = useState('');
  const [selectedNavNos, setSelectedNavNos] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<SyncMode>('all');
  const [syncRunResult, setSyncRunResult] = useState<SyncRunResult | null>(null);

  // Inizializza selezione e mode dal filtro salvato
  useEffect(() => {
    if (filterQuery.data) {
      setMode((filterQuery.data.mode as SyncMode) ?? 'all');
      setSelectedNavNos(new Set(filterQuery.data.navNos));
    }
  }, [filterQuery.data]);

  // ── Derived state ──────────────────────────────────────────────────────────
  const allRecords: PreviewRecord[] = previewQuery.data ?? [];

  const filteredRecords = useMemo(() => {
    if (!textFilter.trim()) return allRecords;
    const q = textFilter.toLowerCase();
    return allRecords.filter(r => r.name.toLowerCase().includes(q));
  }, [allRecords, textFilter]);

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
    saveFilterMutation.mutate({
      entity,
      mode,
      navNos: mode === 'all' ? [] : [...selectedNavNos],
    });
  };

  const handleRunSync = () => {
    setSyncRunResult(null);
    runSyncMutation.mutate(undefined, {
      onSuccess: data => {
        setSyncRunResult(data);
        void statusQuery.refetch();
        if (data.syncDisabled) {
          toast.warning('Sync disabilitato', {
            description: 'Abilita la sincronizzazione in Impostazioni › Microsoft NAV.',
          });
        } else {
          toast.success('Sync completato');
        }
      },
    });
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* ── Tabella preview ─────────────────────────────────────────────── */}
      <SectionCard
        title={`Anteprima ${entityLabel}`}
        description={`Record presenti nella tabella NAV — query live su SQL Server`}
      >
        {/* Filtro testuale */}
        <div className="mb-4 flex items-center gap-3">
          <Input
            placeholder={`Cerca per nome…`}
            value={textFilter}
            onChange={e => setTextFilter(e.target.value)}
            className="max-w-xs"
          />
          {previewQuery.isError && (
            <span className="text-sm text-destructive">
              {previewQuery.error.message}
            </span>
          )}
          <Button
            variant="outline"
            size="sm"
            className="ml-auto"
            onClick={() => void previewQuery.refetch()}
            disabled={previewQuery.isFetching}
          >
            <RefreshCw
              size={14}
              className={previewQuery.isFetching ? 'animate-spin' : ''}
            />
            <span className="ml-1.5">Ricarica</span>
          </Button>
        </div>

        {/* Tabella */}
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
                <TableHead className="w-28">No_</TableHead>
                <TableHead>Nome</TableHead>
                <TableHead className="w-36">Città</TableHead>
                <TableHead className="w-24">Paese</TableHead>
                <TableHead className="w-24 text-center">Bloccato</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {previewQuery.isLoading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 6 }).map((__, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-4 w-full" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : filteredRecords.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                    {previewQuery.isError
                      ? 'Impossibile caricare i dati da NAV.'
                      : textFilter
                        ? 'Nessun risultato per il filtro applicato.'
                        : 'Nessun record trovato.'}
                  </TableCell>
                </TableRow>
              ) : (
                filteredRecords.map(row => (
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
                    <TableCell className="text-muted-foreground">{row.city ?? '—'}</TableCell>
                    <TableCell className="text-muted-foreground">{row.countryCode ?? '—'}</TableCell>
                    <TableCell className="text-center">
                      {row.blocked !== 0 ? (
                        <Badge variant="destructive" className="text-xs">
                          {row.blocked === 1 ? 'Pagamento' : 'Tutto'}
                        </Badge>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {allRecords.length > 0 && (
          <p className="mt-2 text-xs text-muted-foreground">
            {filteredRecords.length === allRecords.length
              ? `${allRecords.length} record totali`
              : `${filteredRecords.length} di ${allRecords.length} record (filtrati)`}
          </p>
        )}
      </SectionCard>

      {/* ── Pannello filtro ──────────────────────────────────────────────── */}
      <SectionCard
        title="Filtro di sincronizzazione"
        description="Configura quali record vengono inclusi nel sync automatico"
      >
        <div className="space-y-4">
          {/* Badge contatore */}
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="text-sm">
              {selectedNavNos.size} su {allRecords.length} selezionati
            </Badge>
            {filterQuery.data?.updatedAt && (
              <span className="text-xs text-muted-foreground">
                Ultimo salvataggio:{' '}
                {new Date(filterQuery.data.updatedAt).toLocaleString('it-IT')}
              </span>
            )}
          </div>

          {/* Radio mode */}
          <div className="space-y-2">
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
          </div>

          {/* Nota contestuale — si aggiorna in tempo reale */}
          <ModeNote mode={mode} entityLabel={entityLabel} />

          <Button
            onClick={handleSaveFilter}
            disabled={saveFilterMutation.isPending}
            size="sm"
          >
            {saveFilterMutation.isPending ? 'Salvataggio…' : 'Salva filtro'}
          </Button>
        </div>
      </SectionCard>

      {/* ── Azioni sync ──────────────────────────────────────────────────── */}
      <SectionCard
        title="Esegui sync"
        description="Avvia manualmente la sincronizzazione per questa entità"
      >
        <div className="space-y-3">
          {/* Banner avviso sync disabilitato */}
          {statusQuery.data && !statusQuery.data.syncEnabled && (
            <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">
              ⚠️ La sincronizzazione è disabilitata. Abilitala in{' '}
              <strong>Impostazioni › Microsoft NAV</strong> prima di eseguire il sync.
            </p>
          )}

          <Button
            onClick={handleRunSync}
            disabled={runSyncMutation.isPending}
            className="gap-2"
          >
            <RefreshCw size={16} className={runSyncMutation.isPending ? 'animate-spin' : ''} />
            {runSyncMutation.isPending ? 'Sincronizzazione in corso…' : 'Esegui sync ora'}
          </Button>

          {syncRunResult && !runSyncMutation.isPending && (
            syncRunResult.syncDisabled ? (
              <p className="text-sm text-amber-600 dark:text-amber-400">
                ⚠️ Sync saltato — sincronizzazione disabilitata in AppConfig.
              </p>
            ) : (() => {
              const r = syncRunResult.results.find(x => x.entity === entity) ?? syncRunResult.results[0];
              if (!r) return null;
              return (
                <p className="text-sm text-green-600 dark:text-green-400">
                  ✓{' '}
                  {r.skipped
                    ? `Sync saltato (filtro entità disabilitato)`
                    : `${r.upserted} record sincronizzati in ${(r.durationMs / 1000).toFixed(1)}s`}
                </p>
              );
            })()
          )}

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
