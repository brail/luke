'use client';

import { useMemo, useState } from 'react';

import { PageHeader } from '../../../../../components/PageHeader';
import { Card, CardContent } from '../../../../../components/ui/card';
import { useAppContext } from '../../../../../contexts/AppContextProvider';
import { trpc } from '../../../../../lib/trpc';
import { cn } from '../../../../../lib/utils';
import { assignBrandColors, resolveBrandColor } from '../../../calendar/utils';

/**
 * Fase 6.1 — Dashboard Termografica di Saturazione.
 * Conta le righe per banda di criticità, raggruppate per brand × categoria prodotto,
 * per la stagione corrente. Nessuna libreria di charting: griglia CSS/Tailwind color-coded.
 */
export default function SaturationDashboardPage() {
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
    return (
      <Card>
        <CardContent>
          <p className="py-12 text-center text-muted-foreground">Seleziona una stagione per visualizzare la saturazione</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <PageHeader
        title="Termografica di Saturazione"
        description="Righe per banda di criticità, per brand e categoria prodotto"
      />

      <div className="p-6">
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
      </div>
    </>
  );
}
