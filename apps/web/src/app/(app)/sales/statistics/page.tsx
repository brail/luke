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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../../../components/ui/tabs';
import { useAppContext } from '../../../../contexts/AppContextProvider';
import { triggerDownload } from '../../../../lib/download';
import { trpc } from '../../../../lib/trpc';
import { getTrpcErrorMessage } from '../../../../lib/trpcErrorMessages';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Filters {
  salespersonCode: string;
  customerCode: string;
}

const EMPTY_FILTERS: Filters = { salespersonCode: '', customerCode: '' };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return 'meno di un minuto';
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) return `${totalMinutes} minut${totalMinutes === 1 ? 'o' : 'i'}`;
  const hours = Math.floor(totalMinutes / 60);
  if (hours < 24) return `${hours} or${hours === 1 ? 'a' : 'e'}`;
  const days = Math.floor(hours / 24);
  return `${days} giorn${days === 1 ? 'o' : 'i'}`;
}

// ─── Progress bar hook ────────────────────────────────────────────────────────

function useProgressBar() {
  const [progress, setProgress] = useState(0);
  const [progressPhase, setProgressPhase] = useState<'query' | 'excel'>('query');
  const progressRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const TICK = 300;

  const start = () => {
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

  const stop = (success: boolean) => {
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

  return { progress, progressPhase, start, stop };
}

// ─── FilterSection component ──────────────────────────────────────────────────

interface FilterSectionProps {
  filters: Filters;
  onFiltersChange: (f: Filters) => void;
  salespersons: { code: string; name: string }[];
  isLoading: boolean;
  isDownloading: boolean;
}

function FilterSection({
  filters,
  onFiltersChange,
  salespersons,
  isLoading,
  isDownloading,
}: FilterSectionProps) {
  return (
    <SectionCard title="Filtri" description="Filtra per agente o cliente (opzionale)">
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="salesperson">Agente (Salesperson)</Label>
          {salespersons.length > 0 ? (
            <Select
              value={filters.salespersonCode}
              onValueChange={value => onFiltersChange({ ...filters, salespersonCode: value })}
              disabled={isLoading}
            >
              <SelectTrigger id="salesperson">
                <SelectValue placeholder="Tutti gli agenti" />
              </SelectTrigger>
              <SelectContent>
                {salespersons.map(sp => (
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
              onChange={e => onFiltersChange({ ...filters, salespersonCode: e.target.value })}
              disabled={isLoading}
            />
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="customer">Cliente (Sell-to)</Label>
          <Input
            id="customer"
            placeholder="Codice cliente (es. C06995)"
            value={filters.customerCode}
            onChange={e => onFiltersChange({ ...filters, customerCode: e.target.value })}
            disabled={isLoading}
          />
        </div>
      </div>

      {(filters.salespersonCode || filters.customerCode) && (
        <div className="mt-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onFiltersChange(EMPTY_FILTERS)}
            disabled={isDownloading}
          >
            Rimuovi filtri
          </Button>
        </div>
      )}
    </SectionCard>
  );
}

// ─── DownloadSection component ────────────────────────────────────────────────

interface DownloadSectionProps {
  label: string;
  lastSyncLabel: string | null;
  nextSyncLabel: string | null;
  enabled: boolean;
  isDownloading: boolean;
  progress: number;
  progressPhase: 'query' | 'excel';
  filters: Filters;
  brand: { code: string } | null;
  season: { code: string } | null;
  onDownload: () => void;
}

function DownloadSection({
  label,
  lastSyncLabel,
  nextSyncLabel,
  enabled,
  isDownloading,
  progress,
  progressPhase,
  filters,
  brand,
  season,
  onDownload,
}: DownloadSectionProps) {
  return (
    <SectionCard
      title="Download Excel"
      description={`Genera il file xlsx con ${label} per il contesto corrente.`}
    >
      {!lastSyncLabel && (
        <Alert variant="destructive" className="mb-4">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Sync non disponibile</AlertTitle>
          <AlertDescription>
            I dati non sono stati sincronizzati. Contatta l'amministratore.
          </AlertDescription>
        </Alert>
      )}

      {lastSyncLabel && (
        <p className="mb-3 text-xs text-muted-foreground">
          Ultimo aggiornamento: {lastSyncLabel}
          {nextSyncLabel && <> · prossimo sync {nextSyncLabel}</>}
        </p>
      )}

      <div className="flex items-center gap-3">
        <Button
          onClick={onDownload}
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
              Scarica Excel
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
  );
}

// ─── Component principale ─────────────────────────────────────────────────────

export default function StatisticsPage() {
  const { brand, season, isLoading: contextLoading } = useAppContext();

  const [pfFilters, setPfFilters] = useState<Filters>(EMPTY_FILTERS);
  const [kimoFilters, setKimoFilters] = useState<Filters>(EMPTY_FILTERS);

  const pfProgress  = useProgressBar();
  const kimoProgress = useProgressBar();

  const enabled = !!brand?.id && !!season?.id;

  // ── Portafoglio ──────────────────────────────────────────────────────────────

  const { data: pfFiltersData, isLoading: pfFiltersLoading } =
    trpc.sales.statistics.portafoglio.getFilters.useQuery(
      { brandId: brand?.id ?? '', seasonId: season?.id ?? '' },
      { enabled, retry: false },
    );

  const { data: pfSyncState } =
    trpc.sales.statistics.portafoglio.getSyncState.useQuery(undefined, {
      refetchInterval: 60_000,
    });

  const { data: pfSyncSchedule } =
    trpc.integrations.nav.sync.getFilter.useQuery(
      { entity: 'portafoglio' },
      { refetchOnWindowFocus: false },
    );

  const pfDownloadMutation = trpc.sales.statistics.portafoglio.download.useMutation({
    onSuccess: result => {
      triggerDownload(result.data, result.filename, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      pfProgress.stop(true);
      const secs = (result.queryDurationMs / 1000).toFixed(1);
      toast.success(`Download completato — ${result.rowCount.toLocaleString('it-IT')} righe in ${secs} s`);
    },
    onError: err => {
      pfProgress.stop(false);
      toast.error(getTrpcErrorMessage(err, { default: 'Errore durante il download del portafoglio' }));
    },
  });

  const handlePfDownload = () => {
    if (!brand?.id || !season?.id) return;
    pfProgress.start();
    pfDownloadMutation.mutate({
      brandId: brand.id,
      seasonId: season.id,
      salespersonCode: pfFilters.salespersonCode || undefined,
      customerCode: pfFilters.customerCode || undefined,
    });
  };

  // Stato sync portafoglio
  const pfSyncStatusInfo = (() => {
    const headerState = pfSyncState?.tables.find(t => t.tableName === 'nav_pf_sales_header');
    if (!headerState?.lastSyncedAt) return null;
    const lastSync = new Date(headerState.lastSyncedAt);
    const elapsedSince = Date.now() - lastSync.getTime();
    const lastSyncLabel = `${lastSync.toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' })} (${formatDuration(elapsedSince)} fa)`;
    const autoEnabled = pfSyncSchedule?.autoSyncEnabled ?? false;
    let nextSyncLabel: string | null = null;
    if (autoEnabled && pfSyncSchedule?.intervalMinutes) {
      const intervalMs = pfSyncSchedule.intervalMinutes * 60 * 1000;
      const remainingMs = Math.max(0, intervalMs - elapsedSince);
      nextSyncLabel = remainingMs === 0 ? 'imminente' : `tra ${formatDuration(remainingMs)}`;
    }
    return { lastSyncLabel, nextSyncLabel };
  })();

  // ── Kimo ─────────────────────────────────────────────────────────────────────

  const { data: kimoFiltersData, isLoading: kimoFiltersLoading } =
    trpc.sales.statistics.kimo.getFilters.useQuery(
      { brandId: brand?.id ?? '', seasonId: season?.id ?? '' },
      { enabled, retry: false },
    );

  const { data: kimoSyncState } =
    trpc.sales.statistics.kimo.getSyncState.useQuery(undefined, {
      refetchInterval: 60_000,
    });

  const { data: kimoSyncSchedule } =
    trpc.integrations.nav.sync.getFilter.useQuery(
      { entity: 'kimo' },
      { refetchOnWindowFocus: false },
    );

  const kimoDownloadMutation = trpc.sales.statistics.kimo.download.useMutation({
    onSuccess: result => {
      triggerDownload(result.data, result.filename, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      kimoProgress.stop(true);
      const secs = (result.queryDurationMs / 1000).toFixed(1);
      toast.success(`Download completato — ${result.rowCount.toLocaleString('it-IT')} righe in ${secs} s`);
    },
    onError: err => {
      kimoProgress.stop(false);
      toast.error(getTrpcErrorMessage(err, { default: 'Errore durante il download Kimo' }));
    },
  });

  const handleKimoDownload = () => {
    if (!brand?.id || !season?.id) return;
    kimoProgress.start();
    kimoDownloadMutation.mutate({
      brandId: brand.id,
      seasonId: season.id,
      salespersonCode: kimoFilters.salespersonCode || undefined,
      customerCode: kimoFilters.customerCode || undefined,
    });
  };

  // Stato sync kimo
  const kimoSyncStatusInfo = (() => {
    const headerState = kimoSyncState?.tables.find(t => t.tableName === 'nav_kimo_sales_header');
    if (!headerState?.lastSyncedAt) return null;
    const lastSync = new Date(headerState.lastSyncedAt);
    const elapsedSince = Date.now() - lastSync.getTime();
    const lastSyncLabel = `${lastSync.toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' })} (${formatDuration(elapsedSince)} fa)`;
    const autoEnabled = kimoSyncSchedule?.autoSyncEnabled ?? false;
    let nextSyncLabel: string | null = null;
    if (autoEnabled && kimoSyncSchedule?.intervalMinutes) {
      const intervalMs = kimoSyncSchedule.intervalMinutes * 60 * 1000;
      const remainingMs = Math.max(0, intervalMs - elapsedSince);
      nextSyncLabel = remainingMs === 0 ? 'imminente' : `tra ${formatDuration(remainingMs)}`;
    }
    return { lastSyncLabel, nextSyncLabel };
  })();

  // ── Render ───────────────────────────────────────────────────────────────────

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
        title="Estrazione Statistiche Vendite"
        description={
          brand && season
            ? `${brand.name} — ${season.name}`
            : 'Estrazioni del portafoglio ordini e dati KIMO-FASHION'
        }
      />

      <Tabs defaultValue="portafoglio">
        <TabsList className="mb-4">
          <TabsTrigger value="portafoglio">Portafoglio Ordini</TabsTrigger>
          <TabsTrigger value="kimo">Vendite + Bidone Kimo</TabsTrigger>
        </TabsList>

        {/* ── Tab: Portafoglio Ordini ─────────────────────────────────────── */}
        <TabsContent value="portafoglio" className="space-y-4">
          <FilterSection
            filters={pfFilters}
            onFiltersChange={setPfFilters}
            salespersons={pfFiltersData?.salespersons ?? []}
            isLoading={contextLoading || pfFiltersLoading}
            isDownloading={pfDownloadMutation.isPending}
          />
          <DownloadSection
            label="il portafoglio ordini completo"
            lastSyncLabel={pfSyncStatusInfo?.lastSyncLabel ?? null}
            nextSyncLabel={pfSyncStatusInfo?.nextSyncLabel ?? null}
            enabled={enabled}
            isDownloading={pfDownloadMutation.isPending}
            progress={pfProgress.progress}
            progressPhase={pfProgress.progressPhase}
            filters={pfFilters}
            brand={brand}
            season={season}
            onDownload={handlePfDownload}
          />
        </TabsContent>

        {/* ── Tab: Vendite + Bidone Kimo ──────────────────────────────────── */}
        <TabsContent value="kimo" className="space-y-4">
          <FilterSection
            filters={kimoFilters}
            onFiltersChange={setKimoFilters}
            salespersons={kimoFiltersData?.salespersons ?? []}
            isLoading={contextLoading || kimoFiltersLoading}
            isDownloading={kimoDownloadMutation.isPending}
          />
          <DownloadSection
            label="le vendite SO e i basket KIMO-FASHION non assegnati"
            lastSyncLabel={kimoSyncStatusInfo?.lastSyncLabel ?? null}
            nextSyncLabel={kimoSyncStatusInfo?.nextSyncLabel ?? null}
            enabled={enabled}
            isDownloading={kimoDownloadMutation.isPending}
            progress={kimoProgress.progress}
            progressPhase={kimoProgress.progressPhase}
            filters={kimoFilters}
            brand={brand}
            season={season}
            onDownload={handleKimoDownload}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
