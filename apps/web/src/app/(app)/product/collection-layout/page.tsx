'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';

import type { RouterOutputs } from '@luke/api';
import type { CollectionLayoutRowInput } from '@luke/core';

import { PageHeader } from '../../../../components/PageHeader';
import { SectionCard } from '../../../../components/SectionCard';
import { Card, CardContent } from '../../../../components/ui/card';
import { useAppContext } from '../../../../contexts/AppContextProvider';
import { usePermission } from '../../../../hooks/usePermission';
import { trpc } from '../../../../lib/trpc';
import { getTrpcErrorMessage } from '../../../../lib/trpcErrorMessages';

import { CollectionGroupDialog } from './_components/CollectionGroupDialog';
import { CollectionLayoutSummary } from './_components/CollectionLayoutSummary';
import { CollectionLayoutTable } from './_components/CollectionLayoutTable';
import { CollectionRowDrawer } from './_components/CollectionRowDrawer';
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

  const [rowDrawer, setRowDrawer] = useState<{
    mode: 'create' | 'edit';
    row?: CollectionRowData;
    defaultGroupId?: string;
  } | null>(null);

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
    onSuccess: () => {
      toast.success('Riga creata');
      setRowDrawer(null);
      invalidateLayout();
    },
    onError: (err: unknown) => toast.error(getTrpcErrorMessage(err)),
  });

  const updateRowMutation = trpc.collectionLayout.rows.update.useMutation({
    onSuccess: () => {
      toast.success('Riga aggiornata');
      setRowDrawer(null);
      invalidateLayout();
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
    } else if (rowDrawer?.mode === 'edit' && rowDrawer.row) {
      updateRowMutation.mutate({ rowId: rowDrawer.row.id, data });
    }
  };

  // Usa sempre i dati freschi dalla query live per evitare snapshot stale nel drawer
  const openEditRow = (row: CollectionRowData) => {
    const fresh =
      layout?.groups.flatMap(g => g.rows).find(r => r.id === row.id) ?? row;
    setRowDrawer({ mode: 'edit', row: fresh });
  };

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
  }, [layout?.id, searchParams, router]);

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
                  setRowDrawer({ mode: 'create', defaultGroupId: groupId })
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
                  setRowDrawer({ mode: 'create', defaultGroupId: groupId })
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
          open={!!rowDrawer}
          onOpenChange={open => {
            if (!open) setRowDrawer(null);
          }}
          mode={rowDrawer?.mode ?? 'create'}
          row={rowDrawer?.row}
          defaultGroupId={rowDrawer?.defaultGroupId}
          groups={layout.groups}
          parameterSets={parameterSets}
          availableGenders={layout.availableGenders}
          brandId={brand?.id ?? ''}
          seasonId={season?.id ?? ''}
          onSubmit={handleRowSubmit}
          onPictureUploaded={() => invalidateLayout()}
          isLoading={isMutating}
          canUpdate={canUpdate}
        />
      )}
    </div>
  );
}
