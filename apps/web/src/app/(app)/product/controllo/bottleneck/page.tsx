'use client';

import { PageHeader } from '../../../../../components/PageHeader';
import { Card, CardContent } from '../../../../../components/ui/card';
import { useAppContext } from '../../../../../contexts/AppContextProvider';
import { trpc } from '../../../../../lib/trpc';

/**
 * Fase 6.2 — Indice di Strozzatura.
 * Conta le righe per banda di criticità, raggruppate per evento/milestone attivo, per il brand
 * e la stagione correnti — identifica quale milestone specifica sta trattenendo più righe.
 */
export default function BottleneckDashboardPage() {
  const { brand, season, isLoading: contextLoading } = useAppContext();
  const enabled = !!brand?.id && !!season?.id;

  const { data: layout } = trpc.collectionLayout.get.useQuery(
    { brandId: brand?.id ?? '', seasonId: season?.id ?? '' },
    { enabled }
  );

  const { data: events = [], isLoading } = trpc.phaseAlert.bottleneckByEvent.useQuery(
    { collectionLayoutId: layout?.id ?? '' },
    { enabled: !!layout?.id }
  );

  const maxCount = Math.max(1, ...events.map(e => e.bands.reduce((s, b) => s + b.count, 0)));

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
        title="Indice di Strozzatura"
        description="Righe critiche per evento di calendario attivo"
      />

      <div className="p-6">
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
      </div>
    </>
  );
}
