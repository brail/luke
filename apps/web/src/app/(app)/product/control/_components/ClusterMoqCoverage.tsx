'use client';

import { useMemo } from 'react';

import { Badge } from '../../../../../components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../../../components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../../../../components/ui/tabs';
import { buildMoqClusters, formatMoqCoverageRatio } from '../../../../../lib/moqCoverage';
import { cn } from '../../../../../lib/utils';
import { useControlLayout } from '../_hooks/useControlLayout';

import {
  ClusterBubbleChart,
  ClusterDivergingBars,
  ClusterHeatmap,
  formatInteger,
  MOQ_STATUS_LABEL,
  MoqStatusLegend,
  plottable,
} from './ClusterMoqCharts';
import { ClusterOverview } from './ClusterOverview';
import { EmptyContextCard } from './EmptyContextCard';
import { QueryStateMessage } from './QueryStateMessage';

const INCOMPLETE_ROWS_HINT =
  "Le righe incomplete sono contate in Qualità Dato (Statistiche Collezione); i fornitori senza minimo per colore sono nell'anagrafica fornitori.";

/**
 * Product clusters of the active brand+season whose forecast falls short of their vendors' colour
 * minimums (#125): four graphical views above one table, all fed by `buildMoqClusters`; the
 * overview (#168) opens first.
 */
export function ClusterMoqCoverage() {
  const { layout, isError, enabled, contextLoading } = useControlLayout();
  // `groups[].rows` only: `layout.rows` lists the same rows again.
  const rows = useMemo(() => layout?.groups.flatMap(g => g.rows) ?? [], [layout]);
  const clusters = useMemo(() => buildMoqClusters(rows), [rows]);
  const plotted = useMemo(() => plottable(clusters), [clusters]);

  if (!enabled && !contextLoading) {
    return <EmptyContextCard message="Seleziona un brand e una stagione" />;
  }
  if (!layout || clusters.length === 0) {
    return (
      <Card>
        <CardContent>
          {layout === undefined ? (
            // A background refetch that fails keeps the loaded layout: the error replaces only a missing one.
            isError ? (
              <QueryStateMessage variant="error" message="Errore nel caricamento del Collection Layout — riprova più tardi" />
            ) : (
              <QueryStateMessage variant="loading" message="Caricamento…" />
            )
          ) : (
            <QueryStateMessage
              variant="empty"
              message={layout === null
                ? 'Nessun Collection Layout per questo brand e stagione'
                : `Nessuna riga completa: servono strategy, posizionamento, SKU e Qty Forecast e un fornitore con il minimo per colore. ${INCOMPLETE_ROWS_HINT}`}
            />
          )}
        </CardContent>
      </Card>
    );
  }

  const completeRows = clusters.reduce((n, c) => n + c.rowCount, 0);
  const unplotted = clusters.length - plotted.length;
  const unplottedNote = unplotted > 0 && (
    <p className="text-xs text-muted-foreground">
      {unplotted} cluster con A o B pari a 0 non si possono disegnare in scala logaritmica: sono nella matrice e nella tabella.
    </p>
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader size="compact">
          <CardTitle size="compact">Copertura dei minimi per cluster</CardTitle>
          <CardDescription>
            A = paia a forecast · B = Σ minimo per colore del fornitore × SKU, riga per riga · righe complete{' '}
            {formatInteger(completeRows)} su {formatInteger(rows.length)}
            {completeRows < rows.length && `. ${INCOMPLETE_ROWS_HINT}`}
          </CardDescription>
          <MoqStatusLegend />
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="overview">
            <TabsList>
              <TabsTrigger value="overview">Panoramica</TabsTrigger>
              <TabsTrigger value="bubbles">Bolle</TabsTrigger>
              <TabsTrigger value="bars">Barre</TabsTrigger>
              <TabsTrigger value="heatmap">Matrice</TabsTrigger>
            </TabsList>
            <TabsContent value="overview">
              <ClusterOverview clusters={clusters} />
            </TabsContent>
            <TabsContent value="bubbles" className="space-y-2">
              <p className="text-xs text-muted-foreground">
                Orizzontale: SKU (affollamento) · verticale: A/B, scala logaritmica · area: A
              </p>
              <ClusterBubbleChart points={plotted} />
              {unplottedNote}
            </TabsContent>
            <TabsContent value="bars" className="space-y-2">
              <p className="text-xs text-muted-foreground">Distanza di A/B dalla soglia, scala logaritmica</p>
              <ClusterDivergingBars points={plotted} />
              {unplottedNote}
            </TabsContent>
            <TabsContent value="heatmap" className="space-y-2">
              <p className="text-xs text-muted-foreground">A/B e SKU per categoria e gender · posizionamento · strategy</p>
              <ClusterHeatmap clusters={clusters} />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-3 py-2 text-left font-medium">Gender</th>
                <th className="px-3 py-2 text-left font-medium">Categoria</th>
                <th className="px-3 py-2 text-left font-medium">Posizionamento</th>
                <th className="px-3 py-2 text-left font-medium">Strategy</th>
                <th className="px-3 py-2 text-right font-medium">SKU</th>
                <th className="px-3 py-2 text-right font-medium">A (paia)</th>
                <th className="px-3 py-2 text-right font-medium">B (paia)</th>
                <th className="px-3 py-2 text-right font-medium">A/B</th>
                <th className="px-3 py-2 text-left font-medium">Stato</th>
              </tr>
            </thead>
            <tbody>
              {clusters.map(c => (
                <tr key={c.key} className={cn('border-b last:border-0', c.belowMoq && 'bg-destructive/10')}>
                  <td className="px-3 py-2">{c.gender}</td>
                  <td className="px-3 py-2 font-medium">{c.category}</td>
                  <td className="px-3 py-2">{c.pricePositioning}</td>
                  <td className="px-3 py-2">{c.strategy}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatInteger(c.sku)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatInteger(c.forecastPairs)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatInteger(c.minimumPairs)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatMoqCoverageRatio(c)}</td>
                  <td className="px-3 py-2">
                    <Badge variant={c.belowMoq ? 'destructive' : 'secondary'}>
                      {c.belowMoq ? MOQ_STATUS_LABEL.below : MOQ_STATUS_LABEL.covered}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
