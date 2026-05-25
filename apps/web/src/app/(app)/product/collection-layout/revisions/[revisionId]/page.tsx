'use client';

import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Calendar, FileText, Tag, User } from 'lucide-react';

import { Badge } from '../../../../../../components/ui/badge';
import { Button } from '../../../../../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../../../../../components/ui/card';
import { PageHeader } from '../../../../../../components/PageHeader';
import { useFormatDate } from '../../../../../../hooks/use-format-date';
import { usePermission } from '../../../../../../hooks/usePermission';
import { trpc } from '../../../../../../lib/trpc';

export default function RevisionDetailPage() {
  const { revisionId } = useParams<{ revisionId: string }>();
  const router = useRouter();
  const fmt = useFormatDate();
  const { can } = usePermission();
  const canViewRevisions = can('collection_layout:view_revisions');

  const { data: revision, isLoading } = trpc.collectionLayoutRevision.getDetail.useQuery(
    { revisionId },
    { enabled: !!revisionId && canViewRevisions, staleTime: 5 * 60 * 1000 },
  );

  if (!canViewRevisions) {
    return <PageHeader title="Revisione" description="Non hai i permessi per visualizzare le revisioni." />;
  }

  if (isLoading) {
    return <PageHeader title="Revisione" description="Caricamento…" />;
  }

  if (!revision) {
    return <PageHeader title="Revisione" description="Revisione non trovata." />;
  }

  const totalRows = revision.groups.flatMap(g => g.rows).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`rev${revision.revisionNumber} — ${revision.revisionTypeValue}`}
        description="Snapshot immutabile del Collection Layout"
        actions={
          <Button variant="outline" size="sm" onClick={() => router.back()}>
            <ArrowLeft className="h-4 w-4 mr-1.5" />
            Storico revisioni
          </Button>
        }
      />

      {/* Metadata */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Dettagli revisione</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div className="space-y-1">
              <dt className="text-xs text-muted-foreground flex items-center gap-1"><Tag className="h-3 w-3" /> Tipo</dt>
              <dd className="text-sm font-medium">{revision.revisionTypeValue}</dd>
            </div>
            <div className="space-y-1">
              <dt className="text-xs text-muted-foreground flex items-center gap-1"><Calendar className="h-3 w-3" /> Data</dt>
              <dd className="text-sm font-medium">{fmt.dateTime(revision.createdAt)}</dd>
            </div>
            <div className="space-y-1">
              <dt className="text-xs text-muted-foreground flex items-center gap-1"><User className="h-3 w-3" /> Autore</dt>
              <dd className="text-sm font-medium">{revision.createdBy.firstName} {revision.createdBy.lastName}</dd>
            </div>
            <div className="space-y-1">
              <dt className="text-xs text-muted-foreground flex items-center gap-1"><FileText className="h-3 w-3" /> Righe</dt>
              <dd className="text-sm font-medium">{totalRows}</dd>
            </div>
          </dl>
          {revision.notes && (
            <div className="mt-4 p-3 rounded-md bg-muted text-sm italic">
              {revision.notes}
            </div>
          )}
          <div className="mt-4 flex items-center gap-2">
            <Badge variant="outline">{revision.cause}</Badge>
          </div>
        </CardContent>
      </Card>

      {/* Groups and rows snapshot */}
      {revision.groups.map(group => (
        <Card key={group.id}>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">{group.name}</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {group.rows.length === 0 ? (
              <p className="text-xs text-muted-foreground">Nessuna riga inclusa in questo gruppo</p>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="text-left py-1.5 px-2 font-medium">Linea</th>
                    <th className="text-left py-1.5 px-2 font-medium">Articolo</th>
                    <th className="text-left py-1.5 px-2 font-medium">Fornitore</th>
                    <th className="text-left py-1.5 px-2 font-medium">Progress</th>
                    <th className="text-left py-1.5 px-2 font-medium">SKU</th>
                    <th className="text-left py-1.5 px-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {group.rows.map(row => (
                    <tr key={row.id} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="py-1.5 px-2 font-medium">{row.line}</td>
                      <td className="py-1.5 px-2 text-muted-foreground">{row.article ?? '—'}</td>
                      <td className="py-1.5 px-2">{row.vendorName ?? '—'}</td>
                      <td className="py-1.5 px-2">{row.progress ?? '—'}</td>
                      <td className="py-1.5 px-2">{row.skuForecast}</td>
                      <td className="py-1.5 px-2">{row.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
