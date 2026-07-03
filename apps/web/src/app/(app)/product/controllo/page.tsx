'use client';

import { useMemo, useState } from 'react';

import { PageHeader } from '../../../../components/PageHeader';
import { Card, CardContent } from '../../../../components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../../../components/ui/tabs';
import { useAppContext } from '../../../../contexts/AppContextProvider';
import { trpc } from '../../../../lib/trpc';
import { cn } from '../../../../lib/utils';
import { assignBrandColors, resolveBrandColor } from '../../calendar/utils';

/**
 * Controllo: Saturazione, Strozzatura, Stagnazione riunite in un'unica pagina a tab.
 */
export default function ControlloPage() {
  return (
    <>
      <PageHeader
        title="Controllo"
        description="Saturazione, strozzatura e stagnazione delle righe di collezione"
      />

      <div className="p-6">
        <Tabs defaultValue="saturation">
          <TabsList>
            <TabsTrigger value="saturation">Saturazione</TabsTrigger>
            <TabsTrigger value="bottleneck">Strozzatura</TabsTrigger>
            <TabsTrigger value="stagnation">Stagnazione</TabsTrigger>
          </TabsList>
          <TabsContent value="saturation">
            <SaturationTab />
          </TabsContent>
          <TabsContent value="bottleneck">
            <BottleneckTab />
          </TabsContent>
          <TabsContent value="stagnation">
            <StagnationTab />
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
}

function EmptyContextCard({ message }: { message: string }) {
  return (
    <Card>
      <CardContent>
        <p className="py-12 text-center text-muted-foreground">{message}</p>
      </CardContent>
    </Card>
  );
}

function useControlloLayout() {
  const { brand, season, isLoading: contextLoading } = useAppContext();
  const enabled = !!brand?.id && !!season?.id;

  const { data: layout } = trpc.collectionLayout.get.useQuery(
    { brandId: brand?.id ?? '', seasonId: season?.id ?? '' },
    { enabled }
  );

  return { layout, enabled, contextLoading };
}

/**
 * Dashboard Termografica di Saturazione.
 * Conta le righe per banda di criticità, raggruppate per brand × categoria prodotto,
 * per la stagione corrente. Nessuna libreria di charting: griglia CSS/Tailwind color-coded.
 */
function SaturationTab() {
  const { season, isLoading: contextLoading } = useAppContext();
  const [selectedBrandIds, setSelectedBrandIds] = useState<string[]>([]);

  const { data: brandsData } = trpc.brand.list.useQuery({ isActive: true, limit: 100 }, { enabled: !!season?.id });
  const allBrands = brandsData?.items ?? [];
  const brandIds = selectedBrandIds.length > 0 ? selectedBrandIds : allBrands.map(b => b.id);

  const { data: cells = [], isLoading } = trpc.phaseAlert.saturationHeatmap.useQuery(
    { seasonId: season?.id ?? '', brandIds },
    { enabled: !!season?.id && brandIds.length > 0 }
  );

  const brandsById = useMemo(() => new Map(allBrands.map(b => [b.id, b])), [allBrands]);
  const brandColorMap = useMemo(() => assignBrandColors(allBrands), [allBrands]);
  const categories = useMemo(() => Array.from(new Set(cells.map(c => c.productCategory))).sort(), [cells]);
  const brandRows = useMemo(() => Array.from(new Set(cells.map(c => c.brandId))), [cells]);

  const cellsByKey = useMemo(() => {
    const map = new Map<string, typeof cells>();
    for (const cell of cells) {
      const key = `${cell.brandId}::${cell.productCategory}`;
      const existing = map.get(key) ?? [];
      existing.push(cell);
      map.set(key, existing);
    }
    return map;
  }, [cells]);

  if (!season && !contextLoading) {
    return <EmptyContextCard message="Seleziona una stagione per visualizzare la saturazione" />;
  }

  return (
    <>
      {allBrands.length > 1 && (
        <div className="flex items-center gap-1.5 flex-wrap mb-4">
          {allBrands.map(b => {
            const selected = brandIds.includes(b.id);
            return (
              <button
                key={b.id}
                type="button"
                onClick={() => setSelectedBrandIds(prev =>
                  prev.includes(b.id) ? prev.filter(id => id !== b.id) : [...prev, b.id]
                )}
                className={cn(
                  'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs border transition-all',
                  selected
                    ? 'border-transparent text-white font-medium'
                    : 'border-border bg-background text-muted-foreground hover:text-foreground',
                )}
                style={selected ? { background: resolveBrandColor(b.id, brandColorMap) } : undefined}
              >
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ background: selected ? 'rgba(255,255,255,0.6)' : resolveBrandColor(b.id, brandColorMap) }}
                />
                {b.name}
              </button>
            );
          })}
        </div>
      )}

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          {isLoading ? (
            <div className="py-12 text-center text-muted-foreground">Caricamento…</div>
          ) : cells.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">Nessun dato di criticità disponibile</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="px-3 py-2 text-left font-medium">Brand</th>
                  {categories.map(cat => (
                    <th key={cat} className="px-3 py-2 text-left font-medium">{cat}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {brandRows.map(brandId => (
                  <tr key={brandId} className="border-b last:border-0">
                    <td className="px-3 py-2 font-medium">{brandsById.get(brandId)?.name ?? brandId}</td>
                    {categories.map(cat => {
                      const cellData = cellsByKey.get(`${brandId}::${cat}`) ?? [];
                      return (
                        <td key={cat} className="px-3 py-2">
                          <div className="flex flex-wrap gap-1">
                            {cellData.map(c => (
                              <span
                                key={c.label}
                                className="px-1.5 py-0.5 rounded text-xs font-medium"
                                style={{ backgroundColor: `${c.color}20`, color: c.color }}
                                title={c.label}
                              >
                                {c.count}
                              </span>
                            ))}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </>
  );
}

/**
 * Indice di Strozzatura.
 * Conta le righe per banda di criticità, raggruppate per evento/milestone attivo, per il brand
 * e la stagione correnti — identifica quale milestone specifica sta trattenendo più righe.
 */
function BottleneckTab() {
  const { layout, enabled, contextLoading } = useControlloLayout();

  const { data: events = [], isLoading } = trpc.phaseAlert.bottleneckByEvent.useQuery(
    { collectionLayoutId: layout?.id ?? '' },
    { enabled: !!layout?.id }
  );

  const maxCount = Math.max(1, ...events.map(e => e.bands.reduce((s, b) => s + b.count, 0)));

  if (!enabled && !contextLoading) {
    return <EmptyContextCard message="Seleziona un brand e una stagione" />;
  }

  return (
    <Card>
      <CardContent className="p-4">
        {isLoading ? (
          <div className="py-12 text-center text-muted-foreground">Caricamento…</div>
        ) : events.length === 0 ? (
          <div className="py-12 text-center text-muted-foreground">Nessun evento attivo con righe in carico</div>
        ) : (
          <div className="space-y-4">
            {events.map(event => {
              const total = event.bands.reduce((s, b) => s + b.count, 0);
              return (
                <div key={event.eventId} className="space-y-1.5">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">{event.eventTitle}</span>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {new Date(event.eventStartAt).toLocaleDateString('it-IT')} · {total} righe
                    </span>
                  </div>
                  <div className="flex h-3 w-full rounded overflow-hidden bg-muted">
                    {event.bands.map(b => (
                      <div
                        key={b.label}
                        style={{ width: `${(b.count / maxCount) * 100}%`, backgroundColor: b.color }}
                        title={`${b.label}: ${b.count}`}
                      />
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {event.bands.map(b => (
                      <span key={b.label} className="text-xs" style={{ color: b.color }}>
                        {b.label}: {b.count}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Monitoraggio Predittivo di Stagnazione.
 * Tempo medio/mediano per fase, dallo storico CollectionRowPhaseHistory — indipendente
 * dal motore alert, identifica righe che stagnano prima ancora di superare la soglia
 * di criticità assoluta.
 */
function StagnationTab() {
  const { layout, enabled, contextLoading } = useControlloLayout();

  const { data: stats = [], isLoading } = trpc.phaseHistory.layoutStats.useQuery(
    { collectionLayoutId: layout?.id ?? '' },
    { enabled: !!layout?.id }
  );

  const sorted = [...stats].sort((a, b) => b.avgDays - a.avgDays);
  const maxAvg = Math.max(1, ...stats.map(s => s.avgDays));

  if (!enabled && !contextLoading) {
    return <EmptyContextCard message="Seleziona un brand e una stagione" />;
  }

  return (
    <Card>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="py-12 text-center text-muted-foreground">Caricamento…</div>
        ) : sorted.length === 0 ? (
          <div className="py-12 text-center text-muted-foreground">
            Nessuno storico di transizione fase disponibile per questo layout
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-3 py-2 text-left font-medium">Fase</th>
                <th className="px-3 py-2 text-left font-medium">Distribuzione</th>
                <th className="px-3 py-2 text-right font-medium">Media (gg)</th>
                <th className="px-3 py-2 text-right font-medium">Mediana (gg)</th>
                <th className="px-3 py-2 text-right font-medium">Campioni</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(s => (
                <tr key={s.phaseId} className="border-b last:border-0">
                  <td className="px-3 py-2 font-medium">{s.phaseLabel}</td>
                  <td className="px-3 py-2 w-48">
                    <div className="h-2 rounded bg-muted overflow-hidden">
                      <div
                        className="h-full bg-primary"
                        style={{ width: `${(s.avgDays / maxAvg) * 100}%` }}
                      />
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{s.avgDays}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{s.medianDays}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{s.sampleCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}
