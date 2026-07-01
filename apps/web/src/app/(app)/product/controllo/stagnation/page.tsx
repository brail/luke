'use client';

import { PageHeader } from '../../../../../components/PageHeader';
import { Card, CardContent } from '../../../../../components/ui/card';
import { useAppContext } from '../../../../../contexts/AppContextProvider';
import { trpc } from '../../../../../lib/trpc';

/**
 * Fase 6.3 — Monitoraggio Predittivo di Stagnazione.
 * Tempo medio/mediano per fase, dallo storico CollectionRowPhaseHistory (Fase 4) — indipendente
 * dal motore alert (Fase 5), identifica righe che stagnano prima ancora di superare la soglia
 * di criticità assoluta.
 */
export default function StagnationDashboardPage() {
  const { brand, season, isLoading: contextLoading } = useAppContext();
  const enabled = !!brand?.id && !!season?.id;

  const { data: layout } = trpc.collectionLayout.get.useQuery(
    { brandId: brand?.id ?? '', seasonId: season?.id ?? '' },
    { enabled }
  );

  const { data: stats = [], isLoading } = trpc.phaseHistory.layoutStats.useQuery(
    { collectionLayoutId: layout?.id ?? '' },
    { enabled: !!layout?.id }
  );

  const sorted = [...stats].sort((a, b) => b.avgDays - a.avgDays);
  const maxAvg = Math.max(1, ...stats.map(s => s.avgDays));

  if (!enabled && !contextLoading) {
    return (
      <Card>
        <CardContent>
          <p className="py-12 text-center text-muted-foreground">Seleziona un brand e una stagione</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <PageHeader
        title="Monitoraggio Predittivo di Stagnazione"
        description="Tempo medio/mediano trascorso in ogni fase, dallo storico transizioni"
      />

      <div className="p-6">
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
      </div>
    </>
  );
}
