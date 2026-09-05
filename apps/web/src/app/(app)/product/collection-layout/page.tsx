'use client';

import { History } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';

import type { RouterOutputs } from '@luke/api';
import type { CollectionLayoutRowInput } from '@luke/core';

import { CreateActionButton } from '../../../../components/CreateActionButton';
import { PageHeader } from '../../../../components/PageHeader';
import { PermissionButton } from '../../../../components/PermissionButton';
import { SectionCard } from '../../../../components/SectionCard';
import { Card, CardContent } from '../../../../components/ui/card';
import { useAppContext } from '../../../../contexts/AppContextProvider';
import { usePermission } from '../../../../hooks/usePermission';
import { triggerDownload } from '../../../../lib/download';
import { trpc } from '../../../../lib/trpc';
import { getTrpcErrorMessage } from '../../../../lib/trpcErrorMessages';

import { CollectionGroupDialog } from './_components/CollectionGroupDialog';
import { CollectionLayoutSummary } from './_components/CollectionLayoutSummary';
import { CollectionLayoutTable } from './_components/CollectionLayoutTable';
import { CollectionRowDrawer } from './_components/CollectionRowDrawer';
import { CreateRevisionDialog } from './_components/CreateRevisionDialog';
import { CriticalityLayoutBanner } from './_components/CriticalityLayoutBanner';
import { EmptyCollectionLayoutState } from './_components/EmptyCollectionLayoutState';

type CollectionLayoutData = NonNullable<
  RouterOutputs['collectionLayout']['get']
>;
type CollectionGroupData = CollectionLayoutData['groups'][number];
type CollectionRowData = CollectionGroupData['rows'][number];

export default function CollectionLayoutPage() {
  const { brand, season, isLoading: contextLoading } = useAppContext();
  const { can } = usePermission();
  const canUpdate = can('collection_layout:update');
  const canRevise = can('collection_layout:revise');
  const canViewRevisions = can('collection_layout:view_revisions');

  const enabled = !!brand?.id && !!season?.id;

  const { data: layoutData, isLoading: layoutLoading } =
    trpc.collectionLayout.get.useQuery(
      { brandId: brand?.id ?? '', seasonId: season?.id ?? '' },
      { enabled }
    );
  // TS2589: RouterOutputs type is excessively deep — as any breaks instantiation before ?? null.
  // Can't route this through narrowRouterOutput<T>() like the other two sites: T here IS the full
  // deep RouterOutputs type (not a shallow hand-written interface), so instantiating a generic
  // function with it is itself what triggers TS2589 — only a plain expression-level `as` cast avoids it.
  const layout = ((layoutData as any) ?? null) as CollectionLayoutData | null;

  const { data: parameterSets = [] } = trpc.pricing.parameterSets.list.useQuery(
    { brandId: brand?.id ?? '', seasonId: season?.id ?? '' },
    { enabled }
  );

  const utils = trpc.useUtils();

  const invalidateLayout = () => {
    utils.collectionLayout.get.invalidate({
      brandId: brand?.id,
      seasonId: season?.id,
    });
    utils.phaseAlert.invalidate();
  };

  // ─── UI state ───────────────────────────────────────────────────
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showCreateRevision, setShowCreateRevision] = useState(false);

  // Chiudi fullscreen con Escape
  useEffect(() => {
    if (!isFullscreen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsFullscreen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isFullscreen]);

  const [groupDialog, setGroupDialog] = useState<{
    mode: 'create' | 'edit';
    group?: CollectionGroupData;
  } | null>(null);

  // Holds the id, not the row: the state snapshot would lag behind the live query
  // (row completion writes and invalidates while drawer is open), and the row
  // re-resolves anyway every render — see `editingRow`.
  const [rowDrawer, setRowDrawer] = useState<{
    mode: 'create' | 'edit';
    rowId?: string;
    defaultGroupId?: string;
  } | null>(null);
  // Bumped by `openRowDrawer` (never during render — see its own comment) exactly when a new
  // editing session starts, so `key={rowDrawerKey}` below forces `CollectionRowDrawer` to remount
  // instead of reusing its previous session's `useForm()`/local state. Left untouched by closing:
  // the key must stay stable while `rowDrawer` goes back to `null`, or the still-mounted, merely
  // hidden instance would remount mid-close (Radix animates the dialog closed on the same instance).
  const [rowDrawerSessionSeq, setRowDrawerSessionSeq] = useState(0);

  // ─── Mutations ──────────────────────────────────────────────────
  const getOrCreateMutation = trpc.collectionLayout.getOrCreate.useMutation({
    onSuccess: () => {
      toast.success('Collection Layout creato');
      invalidateLayout();
    },
    onError: (err: unknown) => toast.error(getTrpcErrorMessage(err)),
  });

  const copyFromSeasonMutation =
    trpc.collectionLayout.copyFromSeason.useMutation({
      onSuccess: () => {
        toast.success('Layout copiato dalla stagione selezionata');
        invalidateLayout();
      },
      onError: (err: unknown) =>
        toast.error(
          getTrpcErrorMessage(err, {
            CONFLICT: 'Un layout esiste già per questa stagione',
            NOT_FOUND: 'Nessun layout trovato nella stagione di partenza',
          })
        ),
    });

  const createGroupMutation = trpc.collectionLayout.groups.create.useMutation({
    onSuccess: () => {
      toast.success('Gruppo creato');
      setGroupDialog(null);
      invalidateLayout();
    },
    onError: (err: unknown) => toast.error(getTrpcErrorMessage(err)),
  });

  const updateGroupMutation = trpc.collectionLayout.groups.update.useMutation({
    onSuccess: () => {
      toast.success('Gruppo rinominato');
      setGroupDialog(null);
      invalidateLayout();
    },
    onError: (err: unknown) => toast.error(getTrpcErrorMessage(err)),
  });

  const deleteGroupMutation = trpc.collectionLayout.groups.delete.useMutation({
    onSuccess: () => {
      toast.success('Gruppo eliminato');
      invalidateLayout();
    },
    onError: (err: unknown) => toast.error(getTrpcErrorMessage(err)),
  });

  const createRowMutation = trpc.collectionLayout.rows.create.useMutation({
    onSuccess: result => {
      toast.success('Riga creata');
      setRowDrawer(null);
      invalidateLayout();
      utils.auditLog.getLastChange.invalidate({ targetType: 'CollectionLayoutRow', targetId: result.id });
    },
    onError: (err: unknown) => toast.error(getTrpcErrorMessage(err)),
  });

  const updateRowMutation = trpc.collectionLayout.rows.update.useMutation({
    onSuccess: result => {
      toast.success('Riga aggiornata');
      setRowDrawer(null);
      invalidateLayout();
      utils.auditLog.getLastChange.invalidate({ targetType: 'CollectionLayoutRow', targetId: result.id });
    },
    onError: (err: unknown) => toast.error(getTrpcErrorMessage(err)),
  });

  const deleteRowMutation = trpc.collectionLayout.rows.delete.useMutation({
    onSuccess: () => {
      toast.success('Riga eliminata');
      invalidateLayout();
    },
    onError: (err: unknown) => toast.error(getTrpcErrorMessage(err)),
  });

  const duplicateRowMutation = trpc.collectionLayout.rows.duplicate.useMutation(
    {
      onSuccess: () => {
        toast.success('Riga duplicata');
        invalidateLayout();
      },
      onError: (err: unknown) => toast.error(getTrpcErrorMessage(err)),
    }
  );

  const updateSettingsMutation =
    trpc.collectionLayout.updateSettings.useMutation({
      onSuccess: () => invalidateLayout(),
      onError: (err: unknown) => toast.error(getTrpcErrorMessage(err)),
    });

  const exportXlsxMutation = trpc.collectionLayout.export.xlsx.useMutation({
    onSuccess: result =>
      triggerDownload(
        result.data,
        result.filename,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      ),
    onError: (err: unknown) =>
      toast.error(
        getTrpcErrorMessage(err, { default: "Errore durante l'esportazione XLSX" })
      ),
  });

  const exportPdfMutation = trpc.collectionLayout.export.pdf.useMutation({
    onSuccess: result =>
      triggerDownload(result.data, result.filename, 'application/pdf'),
    onError: (err: unknown) =>
      toast.error(
        getTrpcErrorMessage(err, { default: "Errore durante l'esportazione PDF" })
      ),
  });

  const isMutating =
    createGroupMutation.isPending ||
    updateGroupMutation.isPending ||
    deleteGroupMutation.isPending ||
    createRowMutation.isPending ||
    updateRowMutation.isPending ||
    deleteRowMutation.isPending ||
    duplicateRowMutation.isPending;

  // ─── Handlers ───────────────────────────────────────────────────
  const handleGroupSubmit = (name: string, skuBudget: number | null) => {
    if (!layout) return;
    if (groupDialog?.mode === 'create') {
      createGroupMutation.mutate({
        collectionLayoutId: layout.id,
        data: { name, skuBudget },
      });
    } else if (groupDialog?.mode === 'edit' && groupDialog.group) {
      updateGroupMutation.mutate({
        groupId: groupDialog.group.id,
        data: { name, skuBudget },
      });
    }
  };

  const handleRowSubmit = (data: CollectionLayoutRowInput) => {
    if (rowDrawer?.mode === 'create') {
      createRowMutation.mutate(data);
    } else if (rowDrawer?.mode === 'edit' && rowDrawer.rowId) {
      updateRowMutation.mutate({ rowId: rowDrawer.rowId, data });
    }
  };

  // The only way `rowDrawer` is ever set to a non-null value — bumping `rowDrawerSessionSeq`
  // alongside it here (an event-handler, not render) is what makes `rowDrawerKey` change on every
  // genuinely new session, including switching rows while already open and reopening after close.
  // `useCallback` with an empty dep array (both setters are stable, nothing else is captured)
  // keeps this referentially stable, so the deep-link effect below can depend on `openEditRow`
  // directly instead of needing to suppress the lint warning for omitting it.
  const openRowDrawer = useCallback((next: { mode: 'create' | 'edit'; rowId?: string; defaultGroupId?: string }) => {
    setRowDrawer(next);
    setRowDrawerSessionSeq(seq => seq + 1);
  }, []);

  const openEditRow = useCallback(
    (row: CollectionRowData) => openRowDrawer({ mode: 'edit', rowId: row.id }),
    [openRowDrawer]
  );

  /** Riga in modifica, risolta a ogni render dalla query live invece che da uno snapshot in state:
   * la conclusione della riga scrive subito e invalida il layout mentre il drawer è aperto.
   * Deliberatamente non memoizzata — una dependency array dovrebbe includere `layout` intero
   * (troppo profondo per TS, vedi TS2589 nel deep-link sotto), e una chiave più stretta come
   * `layout.updatedAt` non cambierebbe alla modifica di una riga, restituendo un dato vecchio.
   * La scansione è lineare su qualche centinaio di righe, in una pagina che ne renderizza altrettante. */
  const editingRow: CollectionRowData | undefined = rowDrawer?.rowId
    ? (layout?.groups as { rows: CollectionRowData[] }[] | undefined)
        ?.flatMap(g => g.rows)
        .find(r => r.id === rowDrawer.rowId)
    : undefined;

  const rowDrawerKey = String(rowDrawerSessionSeq);

  // Deep-link from the "Fase scaduta" notification (?rowId=...): opens that row's edit drawer
  // once the layout has loaded, then strips the param so closing the drawer or refreshing doesn't
  // reopen it. Row not found means the currently-selected brand/season doesn't match the one the
  // notification was about — the page doesn't switch brand/season from the link (that's a
  // separate, server-side user-preference concern, see milestoneDeadlineScheduler.ts) — so this
  // is the expected failure mode, not an edge case, and gets an explicit toast rather than a
  // silent no-op.
  const router = useRouter();
  const searchParams = useSearchParams();
  const deepLinkHandledRef = useRef(false);
  useEffect(() => {
    if (deepLinkHandledRef.current || !layout) return;
    const rowId = searchParams.get('rowId');
    if (!rowId) return;
    deepLinkHandledRef.current = true;
    router.replace('/product/collection-layout');
    // `as any` breaks instantiation depth before `.flatMap().find()` — same TS2589 workaround as
    // the `layout` cast above (RouterOutputs is too deep for TS to chain two array ops over it).
    const row = (layout.groups as any).flatMap((g: any) => g.rows).find((r: any) => r.id === rowId) as CollectionRowData | undefined;
    if (row) {
      openEditRow(row);
    } else {
      toast.error('Riga non trovata nel brand/stagione corrente — verifica di aver selezionato il contesto giusto');
    }
    // Depend on `layout?.id` (shallow) rather than `layout` itself — putting the full RouterOutputs
    // type in a dependency array tuple hits the same TS2589 instantiation-depth wall as above.
    // `openEditRow` is stable (see its own `useCallback`) and included normally; only `layout`
    // needs the suppression, verified by temporarily removing it and rerunning ESLint — with
    // `openEditRow` unstable that reported both `layout` and `openEditRow` as missing, and with it
    // fixed it reports only `layout`.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `layout` deliberately excluded: adding it fails tsc (TS2589, verified), same wall as the `as any` cast above.
  }, [layout?.id, searchParams, router, openEditRow]);

  // ─── Render ─────────────────────────────────────────────────────
  if (contextLoading || layoutLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Collection Layout" description="Caricamento…" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Collection Layout"
        description={
          brand && season
            ? `Collezione ${brand.name} — ${season.code} ${season.year}`
            : 'Pianificazione collezione stagionale'
        }
        actions={layout && (
          <div className="flex items-center gap-2">
            <PermissionButton
              hasPermission={canViewRevisions}
              tooltip="Non hai i permessi per visualizzare le revisioni"
              variant="outline"
              size="sm"
              onClick={() => router.push(`/product/collection-layout/revisions?layoutId=${layout.id}` as string as never)}
            >
              <History className="h-4 w-4 mr-1.5" />
              Storico revisioni
            </PermissionButton>
            <CreateActionButton
              label="Crea revisione"
              onClick={() => setShowCreateRevision(true)}
              canCreate={canRevise}
              resourceName="revisioni"
            />
          </div>
        )}
      />

      {!brand || !season ? (
        <SectionCard title="Contesto non selezionato">
          <p className="text-sm text-muted-foreground">
            Seleziona un brand e una stagione dalla barra in alto per
            visualizzare o creare un Collection Layout.
          </p>
        </SectionCard>
      ) : !layout ? (
        <SectionCard title="Collection Layout">
          <EmptyCollectionLayoutState
            brandId={brand.id}
            seasonId={season.id}
            onCreateEmpty={() =>
              getOrCreateMutation.mutate({
                brandId: brand.id,
                seasonId: season.id,
              })
            }
            onCopyFromSeason={fromSeasonId =>
              copyFromSeasonMutation.mutate({
                fromBrandId: brand.id,
                fromSeasonId,
                toBrandId: brand.id,
                toSeasonId: season.id,
              })
            }
            isLoading={
              getOrCreateMutation.isPending || copyFromSeasonMutation.isPending
            }
          />
        </SectionCard>
      ) : (
        <>
          <CriticalityLayoutBanner collectionLayoutId={layout.id} />
          <CollectionLayoutSummary layout={layout} />
          <Card>
            <CardContent className="pt-6">
              <CollectionLayoutTable
                layout={layout}
                canUpdate={canUpdate}
                parameterSets={parameterSets}
                onAddGroup={() => setGroupDialog({ mode: 'create' })}
                onAddRow={groupId =>
                  openRowDrawer({ mode: 'create', defaultGroupId: groupId })
                }
                onEditRow={row => openEditRow(row)}
                onDuplicateRow={rowId => duplicateRowMutation.mutate({ rowId })}
                onDeleteRow={rowId => deleteRowMutation.mutate({ rowId })}
                onRenameGroup={group => setGroupDialog({ mode: 'edit', group })}
                onDeleteGroup={groupId =>
                  deleteGroupMutation.mutate({ groupId })
                }
                onUpdateSettings={settings =>
                  updateSettingsMutation.mutate({
                    collectionLayoutId: layout.id,
                    ...settings,
                  })
                }
                isDeletingRow={deleteRowMutation.isPending}
                onToggleFullscreen={() => setIsFullscreen(true)}
                onExportXlsx={rowIds =>
                  exportXlsxMutation.mutate({ collectionLayoutId: layout.id, rowIds })
                }
                isExportingXlsx={exportXlsxMutation.isPending}
                onExportPdf={rowIds =>
                  exportPdfMutation.mutate({ collectionLayoutId: layout.id, rowIds })
                }
                isExportingPdf={exportPdfMutation.isPending}
              />
            </CardContent>
          </Card>
        </>
      )}

      {/* Fullscreen overlay — renderizzato nel body per uscire dallo stacking context del SidebarProvider */}
      {isFullscreen &&
        layout &&
        createPortal(
          <div className="fixed inset-0 z-50 bg-background flex flex-col">
            <div className="shrink-0 border-b px-6 py-3 flex items-center justify-between bg-card">
              <div className="flex items-center gap-3">
                <span className="font-semibold text-sm">Collection Layout</span>
                {brand && season && (
                  <span className="text-sm text-muted-foreground">
                    {brand.name} — {season.code} {season.year}
                  </span>
                )}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              <CollectionLayoutTable
                layout={layout}
                canUpdate={canUpdate}
                parameterSets={parameterSets}
                onAddGroup={() => setGroupDialog({ mode: 'create' })}
                onAddRow={groupId =>
                  openRowDrawer({ mode: 'create', defaultGroupId: groupId })
                }
                onEditRow={row => openEditRow(row)}
                onDuplicateRow={rowId => duplicateRowMutation.mutate({ rowId })}
                onDeleteRow={rowId => deleteRowMutation.mutate({ rowId })}
                onRenameGroup={group => setGroupDialog({ mode: 'edit', group })}
                onDeleteGroup={groupId =>
                  deleteGroupMutation.mutate({ groupId })
                }
                onUpdateSettings={settings =>
                  updateSettingsMutation.mutate({
                    collectionLayoutId: layout.id,
                    ...settings,
                  })
                }
                isDeletingRow={deleteRowMutation.isPending}
                isFullscreen
                onToggleFullscreen={() => setIsFullscreen(false)}
                onExportXlsx={rowIds =>
                  exportXlsxMutation.mutate({ collectionLayoutId: layout.id, rowIds })
                }
                isExportingXlsx={exportXlsxMutation.isPending}
                onExportPdf={rowIds =>
                  exportPdfMutation.mutate({ collectionLayoutId: layout.id, rowIds })
                }
                isExportingPdf={exportPdfMutation.isPending}
              />
            </div>
          </div>,
          document.body
        )}

      {/* Group create/edit dialog */}
      <CollectionGroupDialog
        open={!!groupDialog}
        onOpenChange={open => {
          if (!open) setGroupDialog(null);
        }}
        mode={groupDialog?.mode ?? 'create'}
        initialName={groupDialog?.group?.name ?? ''}
        initialSkuBudget={groupDialog?.group?.skuBudget ?? null}
        onSubmit={handleGroupSubmit}
        isLoading={
          createGroupMutation.isPending || updateGroupMutation.isPending
        }
      />

      {/* Row create/edit drawer */}
      {layout && (
        <CollectionRowDrawer
          key={rowDrawerKey}
          open={!!rowDrawer}
          onOpenChange={open => {
            if (!open) setRowDrawer(null);
          }}
          mode={rowDrawer?.mode ?? 'create'}
          row={editingRow}
          defaultGroupId={rowDrawer?.defaultGroupId}
          groups={layout.groups}
          parameterSets={parameterSets}
          availableGenders={layout.availableGenders}
          brandId={brand?.id ?? ''}
          seasonId={season?.id ?? ''}
          onSubmit={handleRowSubmit}
          onPictureUploaded={() => invalidateLayout()}
          onCompletionChanged={() => invalidateLayout()}
          isLoading={isMutating}
          canUpdate={canUpdate}
        />
      )}

      {/* Create revision dialog */}
      {layout && (
        <CreateRevisionDialog
          open={showCreateRevision}
          onOpenChange={setShowCreateRevision}
          layout={layout}
          onSuccess={() => invalidateLayout()}
        />
      )}
    </div>
  );
}
