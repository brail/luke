'use client';

import { ArrowLeft, Calendar, FileText, Lock, Tag, User } from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';

import type { RouterOutputs } from '@luke/api';
import { getProxyUrl } from '@luke/core';

import { PageHeader } from '../../../../../../components/PageHeader';
import { Badge } from '../../../../../../components/ui/badge';
import { Button } from '../../../../../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../../../../../components/ui/card';
import { useAppContext } from '../../../../../../contexts/AppContextProvider';
import { useFormatDate } from '../../../../../../hooks/use-format-date';
import { usePermission } from '../../../../../../hooks/usePermission';
import { triggerDownload } from '../../../../../../lib/download';
import { trpc } from '../../../../../../lib/trpc';
import { CollectionLayoutTable } from '../../_components/CollectionLayoutTable';
import { CollectionRowDrawer } from '../../_components/CollectionRowDrawer';

// ─── Types ────────────────────────────────────────────────────────────────────

type FullSnapshot = NonNullable<RouterOutputs['collectionLayoutRevision']['getLayoutAsOf']>;
type PricingParameterSet = RouterOutputs['pricing']['parameterSets']['list'][number];

// ─── Mapper ───────────────────────────────────────────────────────────────────

function mapSnapshotToDisplayLayout(
  snapshot: FullSnapshot,
  collectionLayoutId: string,
  parameterSets: PricingParameterSet[],
) {
  return {
    id: collectionLayoutId,
    hiddenColumns: [] as string[],
    availableGenders: ['MAN', 'WOMAN'],
    brand: { id: '', name: '', code: '', logoKey: null, logoUrl: null },
    season: { id: '', name: '', code: '', year: 0 },
    groups: snapshot.groups.map(g => ({
      id: g.id,
      name: g.name,
      order: g.order,
      skuBudget: g.skuBudget ?? null,
      collectionLayoutId,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      rows: g.rows
        .filter(r => !r.wasDeleted)
        .map(r => ({
          ...r,
          id: r.id,
          groupId: g.id,
          collectionLayoutId,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
          vendor: r.vendorId
            ? { id: r.vendorId, name: r.vendorName ?? '', nickname: null, enabledParameterSets: [] }
            : null,
          pictureUrl: r.pictureKey
            ? getProxyUrl('collection-row-pictures-revisions', r.pictureKey)
            : null,
          quotations: r.quotationRevisions.map(q => ({
            id: q.id,
            order: q.order,
            rowId: r.id,
            pricingParameterSetId: q.pricingParameterSetId,
            retailPrice: q.retailPrice,
            supplierQuotation: q.supplierQuotation,
            notes: q.notes,
            sku: q.sku,
            createdAt: new Date(),
            updatedAt: new Date(),
            pricingParameterSet: q.pricingParameterSetId
              ? (parameterSets.find(ps => ps.id === q.pricingParameterSetId) ?? null)
              : null,
          })),
        })),
    })),
  };
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function RevisionDetailPage() {
  const { revisionId } = useParams<{ revisionId: string }>();
  const router = useRouter();
  const fmt = useFormatDate();
  const { can } = usePermission();
  const { brand, season } = useAppContext();
  const canViewRevisions = can('collection_layout:view_revisions');

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [viewRow, setViewRow] = useState<any | null>(null);

  // Step 1: fetch metadata + collectionLayoutId
  const { data: meta, isLoading: metaLoading } = trpc.collectionLayoutRevision.getDetail.useQuery(
    { revisionId },
    { enabled: !!revisionId && canViewRevisions, staleTime: 5 * 60 * 1000 },
  );

  const collectionLayoutId = meta?.collectionLayoutId;

  // Step 2: fetch full reconstructed layout state (backward lookup across all revisions)
  const { data: snapshot, isLoading: snapshotLoading } = trpc.collectionLayoutRevision.getLayoutAsOf.useQuery(
    { collectionLayoutId: collectionLayoutId ?? '', revisionId },
    { enabled: !!collectionLayoutId && canViewRevisions, staleTime: 5 * 60 * 1000 },
  );

  const { data: parameterSets = [] } = trpc.pricing.parameterSets.list.useQuery(
    { brandId: brand?.id ?? '', seasonId: season?.id ?? '' },
    { enabled: !!brand?.id && !!season?.id },
  );

  const exportXlsxMutation = trpc.collectionLayoutRevision.export.xlsx.useMutation({
    onSuccess: result => triggerDownload(result.data, result.filename, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
  });
  const exportPdfMutation = trpc.collectionLayoutRevision.export.pdf.useMutation({
    onSuccess: result => triggerDownload(result.data, result.filename, 'application/pdf'),
  });

  if (!canViewRevisions) {
    return <PageHeader title="Revisione" description="Non hai i permessi per visualizzare le revisioni." />;
  }

  if (metaLoading || snapshotLoading) {
    return <PageHeader title="Revisione" description="Caricamento…" />;
  }

  if (!meta || !snapshot || !collectionLayoutId) {
    return <PageHeader title="Revisione" description="Revisione non trovata." />;
  }

  const mappedLayout = mapSnapshotToDisplayLayout(snapshot, collectionLayoutId, parameterSets);
  const totalRows = snapshot.groups.flatMap(g => g.rows).filter(r => !r.wasDeleted).length;

  return (
    <div className="space-y-4">
      <PageHeader
        title={`rev${meta.revisionNumber} — ${meta.revisionTypeValue}`}
        description="Snapshot immutabile del Collection Layout"
        actions={
          <Button variant="outline" size="sm" onClick={() => router.back()}>
            <ArrowLeft className="h-4 w-4 mr-1.5" />
            Storico revisioni
          </Button>
        }
      />

      {/* Revision metadata */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Lock className="h-4 w-4 text-muted-foreground" />
            Dettagli revisione
          </CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div className="space-y-1">
              <dt className="text-xs text-muted-foreground flex items-center gap-1"><Tag className="h-3 w-3" /> Tipo</dt>
              <dd className="text-sm font-medium">{meta.revisionTypeValue}</dd>
            </div>
            <div className="space-y-1">
              <dt className="text-xs text-muted-foreground flex items-center gap-1"><Calendar className="h-3 w-3" /> Data</dt>
              <dd className="text-sm font-medium">{fmt.dateTime(meta.createdAt)}</dd>
            </div>
            <div className="space-y-1">
              <dt className="text-xs text-muted-foreground flex items-center gap-1"><User className="h-3 w-3" /> Autore</dt>
              <dd className="text-sm font-medium">{meta.createdBy.firstName} {meta.createdBy.lastName}</dd>
            </div>
            <div className="space-y-1">
              <dt className="text-xs text-muted-foreground flex items-center gap-1"><FileText className="h-3 w-3" /> Righe</dt>
              <dd className="text-sm font-medium">{totalRows}</dd>
            </div>
          </dl>
          {meta.notes && (
            <div className="mt-4 p-3 rounded-md bg-muted text-sm italic">{meta.notes}</div>
          )}
          <div className="mt-4 flex items-center gap-2">
            <Badge variant="outline">{meta.cause}</Badge>
          </div>
        </CardContent>
      </Card>

      {/* Full read-only table — reconstructed state across all revisions */}
      <CollectionLayoutTable
        layout={mappedLayout as any}
        canUpdate={false}
        readOnly={true}
        parameterSets={parameterSets as any}
        onAddGroup={() => {}}
        onAddRow={() => {}}
        onEditRow={row => setViewRow(row)}
        onDuplicateRow={() => {}}
        onDeleteRow={() => {}}
        onRenameGroup={() => {}}
        onDeleteGroup={() => {}}
        onUpdateSettings={() => {}}
        onExportXlsx={() =>
          exportXlsxMutation.mutate({ revisionId, collectionLayoutId })
        }
        onExportPdf={() =>
          exportPdfMutation.mutate({ revisionId, collectionLayoutId })
        }
        isExportingXlsx={exportXlsxMutation.isPending}
        isExportingPdf={exportPdfMutation.isPending}
      />

      {/* Read-only row detail drawer */}
      {viewRow && (
        <CollectionRowDrawer
          open={!!viewRow}
          onOpenChange={open => { if (!open) setViewRow(null); }}
          mode="edit"
          row={viewRow as any}
          groups={mappedLayout.groups as any}
          parameterSets={parameterSets as any}
          availableGenders={['MAN', 'WOMAN']}
          brandId={brand?.id ?? ''}
          seasonId={season?.id ?? ''}
          canUpdate={false}
          onSubmit={() => {}}
        />
      )}
    </div>
  );
}
