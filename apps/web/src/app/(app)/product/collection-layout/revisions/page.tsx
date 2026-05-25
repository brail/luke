'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, ChevronRight } from 'lucide-react';

import { Badge } from '../../../../../components/ui/badge';
import { Button } from '../../../../../components/ui/button';
import { Card, CardContent } from '../../../../../components/ui/card';
import { PageHeader } from '../../../../../components/PageHeader';
import { useFormatDate } from '../../../../../hooks/use-format-date';
import { usePermission } from '../../../../../hooks/usePermission';
import { trpc } from '../../../../../lib/trpc';

export default function CollectionLayoutRevisionsPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const fmt = useFormatDate();
  const { can } = usePermission();
  const canViewRevisions = can('collection_layout:view_revisions');

  const layoutId = searchParams.get('layoutId') ?? '';

  const { data: revisions = [], isLoading } = trpc.collectionLayoutRevision.list.useQuery(
    { collectionLayoutId: layoutId },
    { enabled: !!layoutId && canViewRevisions, staleTime: 30 * 1000 },
  );

  if (!canViewRevisions) {
    return <PageHeader title="Storico revisioni" description="Non hai i permessi per visualizzare le revisioni." />;
  }

  if (!layoutId) {
    return <PageHeader title="Storico revisioni" description="Parametro layoutId mancante." />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Storico revisioni"
        description="Registro qualità ISO 9001:2015 — Collection Layout"
        actions={
          <Button variant="outline" size="sm" onClick={() => router.back()}>
            <ArrowLeft className="h-4 w-4 mr-1.5" />
            Torna al CL
          </Button>
        }
      />

      <Card>
        <CardContent className="pt-6">
          {isLoading ? (
            <p className="text-sm text-muted-foreground text-center py-8">Caricamento…</p>
          ) : revisions.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              Nessuna revisione creata. Usa il bottone "Crea revisione" nella pagina Collection Layout.
            </p>
          ) : (
            <div className="space-y-2">
              {revisions.map(rev => (
                <div
                  key={rev.id}
                  className="flex items-center justify-between p-4 rounded-lg border hover:bg-muted/50 cursor-pointer transition-colors"
                  onClick={() => router.push(`/product/collection-layout/revisions/${rev.id}` as string as never)}
                >
                  <div className="flex items-center gap-4">
                    <div className="w-12 text-center">
                      <span className="font-mono text-lg font-bold">rev{rev.revisionNumber}</span>
                    </div>
                    <div>
                      <div className="font-medium">{rev.revisionTypeValue}</div>
                      <div className="text-sm text-muted-foreground">
                        {fmt.dateTime(rev.createdAt)} · {rev.createdBy.firstName} {rev.createdBy.lastName} · {rev.rowCount} righe
                      </div>
                      {rev.notes && (
                        <div className="text-xs text-muted-foreground mt-0.5 italic">{rev.notes}</div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{rev.cause}</Badge>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
