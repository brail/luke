'use client';

import { AlertCircle, BarChart2, Download, Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { PageHeader } from '../../../../components/PageHeader';
import { SectionCard } from '../../../../components/SectionCard';
import { Alert, AlertDescription, AlertTitle } from '../../../../components/ui/alert';
import { Button } from '../../../../components/ui/button';
import { Input } from '../../../../components/ui/input';
import { Label } from '../../../../components/ui/label';
import { Progress } from '../../../../components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../../components/ui/select';
import { useAppContext } from '../../../../contexts/AppContextProvider';
import { trpc } from '../../../../lib/trpc';
import { getTrpcErrorMessage } from '../../../../lib/trpcErrorMessages';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Filters {
  salespersonCode: string;
  customerCode: string;
}

const EMPTY_FILTERS: Filters = { salespersonCode: '', customerCode: '' };

// ─── Component ────────────────────────────────────────────────────────────────

export default function StatisticsPage() {
  const { brand, season, isLoading: contextLoading } = useAppContext();
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [progress, setProgress] = useState(0);
  const [progressPhase, setProgressPhase] = useState<'query' | 'excel'>('query');
  const progressRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const enabled = !!brand?.id && !!season?.id;

  // Carica filtri disponibili (lista agenti dal NAV)
  const { data: filtersData, isLoading: filtersLoading } =
    trpc.sales.statistics.portafoglio.getFilters.useQuery(
      { brandId: brand?.id ?? '', seasonId: season?.id ?? '' },
      { enabled, retry: false },
    );

  // Stato sync replica PG + configurazione pianificazione
  const { data: syncState } =
    trpc.sales.statistics.portafoglio.getSyncState.useQuery(undefined, {
      refetchInterval: 60_000,
    });

  const { data: syncSchedule } =
    trpc.integrations.nav.sync.getFilter.useQuery(
      { entity: 'portafoglio' },
      { refetchOnWindowFocus: false },
    );

  // Progress bar a due fasi:
  //   Fase 1 — "query PG":   0 → 60%,  TAU = 4 s  (PG replica tipicamente <5 s)
  //   Fase 2 — "build xlsx": 60 → 90%, TAU = 8 s  (ExcelJS streaming ~2–5 s per 10 k righe)
  // Al completamento salta a 100%.
  const TICK = 300;

  const startProgress = () => {
    setProgress(0);
    setProgressPhase('query');
    const startTime = Date.now();
    let phase: 'query' | 'excel' = 'query';

    progressRef.current = setInterval(() => {
      const elapsed = Date.now() - startTime;

      if (phase === 'query') {
        const next = 60 * (1 - Math.exp(-elapsed / 4_000));
        if (next >= 59) {
          phase = 'excel';
          setProgressPhase('excel');
        }
        setProgress(Math.min(next, 60));
      } else {
        const phase2Elapsed = elapsed - 4_000 * Math.log(1 / (1 - 59 / 60));
        const next = 60 + 30 * (1 - Math.exp(-Math.max(0, phase2Elapsed) / 8_000));
        setProgress(Math.min(next, 90));
      }
    }, TICK);
  };

  const stopProgress = (success: boolean) => {
    if (progressRef.current) {
      clearInterval(progressRef.current);
      progressRef.current = null;
    }
    if (success) {
      setProgress(100);
      setTimeout(() => setProgress(0), 800);
    } else {
      setProgress(0);
    }
  };

  useEffect(() => () => { if (progressRef.current) clearInterval(progressRef.current); }, []);

  // Mutation per il download
  const downloadMutation = trpc.sales.statistics.portafoglio.download.useMutation({
    onSuccess: result => {
      // eslint-disable-next-line no-undef
      const binaryStr = atob(result.data);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }
      const blob = new Blob([bytes], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = result.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      stopProgress(true);
      const secs = (result.queryDurationMs / 1000).toFixed(1);
      toast.success(`Download completato — ${result.rowCount.toLocaleString('it-IT')} righe in ${secs} s`);
    },
    onError: err => {
      stopProgress(false);
      toast.error(getTrpcErrorMessage(err, { default: 'Errore durante il download del portafoglio' }));
    },
  });

  const handleDownload = () => {
    if (!brand?.id || !season?.id) return;
    startProgress();
    downloadMutation.mutate({
      brandId: brand.id,
      seasonId: season.id,
      salespersonCode: filters.salespersonCode || undefined,
      customerCode: filters.customerCode || undefined,
    });
  };

  const handleResetFilters = () => setFilters(EMPTY_FILTERS);

  const isLoading = contextLoading || filtersLoading;
  const isDownloading = downloadMutation.isPending;

  // Formatta una durata in ms in testo leggibile (italiano)
  const formatDuration = (ms: number): string => {
    const totalSeconds = Math.floor(ms / 1000);
    if (totalSeconds < 60) return 'meno di un minuto';
    const totalMinutes = Math.floor(totalSeconds / 60);
    if (totalMinutes < 60) return `${totalMinutes} minut${totalMinutes === 1 ? 'o' : 'i'}`;
    const hours = Math.floor(totalMinutes / 60);
    if (hours < 24) return `${hours} or${hours === 1 ? 'a' : 'e'}`;
    const days = Math.floor(hours / 24);
    return `${days} giorn${days === 1 ? 'o' : 'i'}`;
  };

  const syncStatusInfo = (() => {
    const headerState = syncState?.tables.find(t => t.tableName === 'nav_pf_sales_header');
    if (!headerState?.lastSyncedAt) return null;
    const lastSync = new Date(headerState.lastSyncedAt);
    const elapsedSince = Date.now() - lastSync.getTime();
    const lastSyncLabel = `${lastSync.toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' })} (${formatDuration(elapsedSince)} fa)`;

    const autoEnabled = syncSchedule?.autoSyncEnabled ?? false;
    let nextSyncLabel: string | null = null;
    if (autoEnabled && syncSchedule?.intervalMinutes) {
      const intervalMs = syncSchedule.intervalMinutes * 60 * 1000;
      const elapsedMs = Date.now() - lastSync.getTime();
      const remainingMs = Math.max(0, intervalMs - elapsedMs);
      nextSyncLabel = remainingMs === 0 ? 'imminente' : `tra ${formatDuration(remainingMs)}`;
    }

    return { lastSyncLabel, nextSyncLabel };
  })();

  // ── Render ──────────────────────────────────────────────────────────────────

  if (!enabled && !contextLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3 text-muted-foreground">
        <BarChart2 size={48} className="opacity-30" />
        <p className="text-sm">Seleziona un brand e una stagione per accedere alle statistiche.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Estrazione Analisi Vendite"
        description={
          brand && season
            ? `${brand.name} — ${season.name}`
            : 'Estrazione completa del portafoglio ordini di vendita'
        }
      />

      <SectionCard
        title="Filtri"
        description="Filtra il portafoglio per agente o cliente (opzionale)"
      >
        <div className="space-y-4">
          {/* Filtro Agente */}
          <div className="space-y-1.5">
            <Label htmlFor="salesperson">Agente (Salesperson)</Label>
            {filtersData && filtersData.salespersons.length > 0 ? (
              <Select
                value={filters.salespersonCode}
                onValueChange={value =>
                  setFilters(f => ({ ...f, salespersonCode: value }))
                }
                disabled={isLoading}
              >
                <SelectTrigger id="salesperson">
                  <SelectValue placeholder="Tutti gli agenti" />
                </SelectTrigger>
                <SelectContent>
                  {filtersData.salespersons.map(sp => (
                    <SelectItem key={sp.code} value={sp.code}>
                      {sp.code} — {sp.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                id="salesperson"
                placeholder="Codice agente (es. 1184)"
                value={filters.salespersonCode}
                onChange={e =>
                  setFilters(f => ({ ...f, salespersonCode: e.target.value }))
                }
                disabled={isLoading}
              />
            )}
          </div>

          {/* Filtro Cliente */}
          <div className="space-y-1.5">
            <Label htmlFor="customer">Cliente (Sell-to)</Label>
            <Input
              id="customer"
              placeholder="Codice cliente (es. C06995)"
              value={filters.customerCode}
              onChange={e =>
                setFilters(f => ({ ...f, customerCode: e.target.value }))
              }
              disabled={isLoading}
            />
          </div>
        </div>

        {(filters.salespersonCode || filters.customerCode) && (
          <div className="mt-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleResetFilters}
              disabled={isDownloading}
            >
              Rimuovi filtri
            </Button>
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="Download Excel"
        description="Genera il file xlsx con il portafoglio ordini completo per il contesto corrente."
      >
        {!syncStatusInfo && (
          <Alert variant="destructive" className="mb-4">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Sync non disponibile</AlertTitle>
            <AlertDescription>
              I dati del portafoglio non sono stati sincronizzati. Contatta l'amministratore.
            </AlertDescription>
          </Alert>
        )}

        {syncStatusInfo && (
          <p className="mb-3 text-xs text-muted-foreground">
            Ultimo aggiornamento: {syncStatusInfo.lastSyncLabel}
            {syncStatusInfo.nextSyncLabel && (
              <> · prossimo sync {syncStatusInfo.nextSyncLabel}</>
            )}
          </p>
        )}

        <div className="flex items-center gap-3">
          <Button
            onClick={handleDownload}
            disabled={!enabled || isDownloading}
            className="gap-2"
          >
            {isDownloading ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Generazione in corso…
              </>
            ) : (
              <>
                <Download size={16} />
                Scarica Portafoglio
              </>
            )}
          </Button>

          {brand && season && (
            <span className="text-sm text-muted-foreground">
              {brand.code} · {season.code}
              {filters.salespersonCode && ` · Agente: ${filters.salespersonCode}`}
              {filters.customerCode && ` · Cliente: ${filters.customerCode}`}
            </span>
          )}
        </div>

        {isDownloading && (
          <div className="mt-4 space-y-1.5">
            <Progress value={progress} className="h-2 transition-all duration-300" />
            <p className="text-xs text-muted-foreground">
              {progressPhase === 'query'
                ? 'Lettura dati da PostgreSQL…'
                : 'Generazione file Excel…'}
            </p>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
