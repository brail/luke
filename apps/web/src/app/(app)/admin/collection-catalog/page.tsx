'use client';

import { GripVertical, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { COLLECTION_CATALOG_TYPES } from '@luke/core';
import type { CollectionCatalogType } from '@luke/core';

import { ConfirmDialog } from '../../../../components/ConfirmDialog';
import { PageHeader } from '../../../../components/PageHeader';
import { Badge } from '../../../../components/ui/badge';
import { Button } from '../../../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../../components/ui/dialog';
import { Input } from '../../../../components/ui/input';
import { Label } from '../../../../components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../../../components/ui/tabs';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../../../../components/ui/tooltip';
import { usePermission } from '../../../../hooks/usePermission';
import { trpc } from '../../../../lib/trpc';
import { getTrpcErrorMessage } from '../../../../lib/trpcErrorMessages';
import { cn } from '../../../../lib/utils';

const TYPE_LABELS: Record<CollectionCatalogType, string> = {
  strategy: 'Strategy',
  lineStatus: 'Line Status',
  styleStatus: 'Style Status',
  progress: 'Progress',
};

type CatalogItem = {
  id: string;
  type: string;
  value: string;
  label: string;
  order: number;
  isActive: boolean;
};

type ItemDialogState = { mode: 'create'; type: CollectionCatalogType } | { mode: 'edit'; item: CatalogItem };

export default function CollectionCatalogPage() {
  const { can } = usePermission();
  const canWrite = can('collection_layout:update');

  const [activeTab, setActiveTab] = useState<CollectionCatalogType>('strategy');
  const [itemDialog, setItemDialog] = useState<ItemDialogState | null>(null);
  const [deletingItem, setDeletingItem] = useState<CatalogItem | null>(null);

  const utils = trpc.useUtils();
  const invalidate = (type: CollectionCatalogType) => {
    void utils.collectionCatalog.listAll.invalidate({ type });
  };

  const { data: items = [], isLoading } = trpc.collectionCatalog.listAll.useQuery(
    { type: activeTab },
    { staleTime: 30 * 1000 },
  );

  const createMutation = trpc.collectionCatalog.create.useMutation({
    onSuccess: () => {
      invalidate(activeTab);
      setItemDialog(null);
      toast.success('Opzione aggiunta');
    },
    onError: e => toast.error(getTrpcErrorMessage(e, { CONFLICT: 'Valore già esistente per questo tipo' })),
  });

  const updateMutation = trpc.collectionCatalog.update.useMutation({
    onSuccess: () => {
      invalidate(activeTab);
      setItemDialog(null);
      toast.success('Opzione aggiornata');
    },
    onError: e => toast.error(getTrpcErrorMessage(e)),
  });

  const removeMutation = trpc.collectionCatalog.remove.useMutation({
    onSuccess: () => {
      invalidate(activeTab);
      setDeletingItem(null);
      toast.success('Opzione disattivata');
    },
    onError: e => toast.error(getTrpcErrorMessage(e)),
  });

  const restoreMutation = trpc.collectionCatalog.restore.useMutation({
    onSuccess: () => { invalidate(activeTab); toast.success('Opzione riattivata'); },
    onError: e => toast.error(getTrpcErrorMessage(e)),
  });

  const isMutating =
    createMutation.isPending || updateMutation.isPending || removeMutation.isPending;

  return (
    <>
      <PageHeader
        title="Collection Catalog"
        description="Opzioni configurabili per il Collection Layout"
      />

      <div className="p-6">
        <Tabs value={activeTab} onValueChange={v => setActiveTab(v as CollectionCatalogType)}>
          <div className="flex items-center justify-between mb-4">
            <TabsList>
              {COLLECTION_CATALOG_TYPES.map(t => (
                <TabsTrigger key={t} value={t}>{TYPE_LABELS[t]}</TabsTrigger>
              ))}
            </TabsList>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <Button
                      size="sm"
                      disabled={!canWrite}
                      className={cn(!canWrite && 'opacity-50 cursor-not-allowed')}
                      onClick={() => canWrite && setItemDialog({ mode: 'create', type: activeTab })}
                    >
                      <Plus className="mr-1 h-4 w-4" />
                      Aggiungi opzione
                    </Button>
                  </span>
                </TooltipTrigger>
                {!canWrite && (
                  <TooltipContent>Non hai i permessi per modificare il catalog</TooltipContent>
                )}
              </Tooltip>
            </TooltipProvider>
          </div>

          {COLLECTION_CATALOG_TYPES.map(type => (
            <TabsContent key={type} value={type}>
              <div className="mt-4 rounded-lg border bg-card">
                {isLoading ? (
                  <div className="p-8 text-center text-sm text-muted-foreground">Caricamento…</div>
                ) : items.length === 0 ? (
                  <div className="p-8 text-center text-sm text-muted-foreground">
                    Nessuna opzione configurata. Aggiungi la prima.
                  </div>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="w-8 px-3 py-2" />
                        <th className="px-3 py-2 text-left font-medium">Valore (chiave)</th>
                        <th className="px-3 py-2 text-left font-medium">Label</th>
                        <th className="px-3 py-2 text-left font-medium">Stato</th>
                        <th className="w-24 px-3 py-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {(items as CatalogItem[]).map(item => (
                        <tr key={item.id} className={cn('border-b last:border-0', !item.isActive && 'opacity-50')}>
                          <td className="px-3 py-2 text-muted-foreground">
                            <GripVertical className="h-4 w-4" />
                          </td>
                          <td className="px-3 py-2 font-mono text-xs">{item.value}</td>
                          <td className="px-3 py-2">{item.label}</td>
                          <td className="px-3 py-2">
                            <Badge variant={item.isActive ? 'default' : 'secondary'}>
                              {item.isActive ? 'Attivo' : 'Inattivo'}
                            </Badge>
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex items-center justify-end gap-1">
                              {!item.isActive ? (
                                <TooltipProvider>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <span>
                                        <Button
                                          size="icon"
                                          variant="ghost"
                                          className={cn('h-7 w-7', !canWrite && 'opacity-50 cursor-not-allowed')}
                                          disabled={!canWrite || restoreMutation.isPending}
                                          onClick={() => canWrite && restoreMutation.mutate({ id: item.id })}
                                        >
                                          <RotateCcw className="h-3.5 w-3.5" />
                                        </Button>
                                      </span>
                                    </TooltipTrigger>
                                    {!canWrite && <TooltipContent>Non hai i permessi per modificare il catalog</TooltipContent>}
                                  </Tooltip>
                                </TooltipProvider>
                              ) : (
                                <>
                                  <TooltipProvider>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <span>
                                          <Button
                                            size="icon"
                                            variant="ghost"
                                            className={cn('h-7 w-7', !canWrite && 'opacity-50 cursor-not-allowed')}
                                            disabled={!canWrite || isMutating}
                                            onClick={() => canWrite && setItemDialog({ mode: 'edit', item })}
                                          >
                                            <Pencil className="h-3.5 w-3.5" />
                                          </Button>
                                        </span>
                                      </TooltipTrigger>
                                      {!canWrite && <TooltipContent>Non hai i permessi per modificare il catalog</TooltipContent>}
                                    </Tooltip>
                                  </TooltipProvider>

                                  <TooltipProvider>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <span>
                                          <Button
                                            size="icon"
                                            variant="ghost"
                                            className={cn('h-7 w-7 text-destructive', !canWrite && 'opacity-50 cursor-not-allowed')}
                                            disabled={!canWrite || isMutating}
                                            onClick={() => canWrite && setDeletingItem(item)}
                                          >
                                            <Trash2 className="h-3.5 w-3.5" />
                                          </Button>
                                        </span>
                                      </TooltipTrigger>
                                      {!canWrite && <TooltipContent>Non hai i permessi per modificare il catalog</TooltipContent>}
                                    </Tooltip>
                                  </TooltipProvider>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </TabsContent>
          ))}
        </Tabs>
      </div>

      {/* Item dialog */}
      {itemDialog && (
        <CatalogItemDialog
          state={itemDialog}
          onClose={() => setItemDialog(null)}
          onSubmit={(data) => {
            if (itemDialog.mode === 'create') {
              createMutation.mutate({ type: itemDialog.type, ...data });
            } else {
              updateMutation.mutate({ id: itemDialog.item.id, data });
            }
          }}
          isLoading={createMutation.isPending || updateMutation.isPending}
        />
      )}

      {/* Delete confirm */}
      <ConfirmDialog
        open={!!deletingItem}
        onOpenChange={open => { if (!open) setDeletingItem(null); }}
        title="Disattiva opzione"
        description={`Disattivare "${deletingItem?.label}"? Non sarà più disponibile nei nuovi record, ma i dati esistenti non vengono modificati.`}
        confirmText="Disattiva"
        cancelText="Annulla"
        variant="destructive"
        actionType="delete"
        onConfirm={() => { if (deletingItem) removeMutation.mutate({ id: deletingItem.id }); }}
        isLoading={removeMutation.isPending}
      />
    </>
  );
}

// ─── Item Dialog ──────────────────────────────────────────────────────────────

function CatalogItemDialog({
  state,
  onClose,
  onSubmit,
  isLoading,
}: {
  state: ItemDialogState;
  onClose: () => void;
  onSubmit: (data: { value: string; label: string }) => void;
  isLoading: boolean;
}) {
  const initial = state.mode === 'edit' ? state.item : null;
  const [value, setValue] = useState(initial?.value ?? '');
  const [label, setLabel] = useState(initial?.label ?? '');

  const canSubmit = value.trim().length > 0 && label.trim().length > 0;

  return (
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {state.mode === 'create' ? 'Aggiungi opzione' : 'Modifica opzione'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="cat-value">Valore (chiave)</Label>
            <Input
              id="cat-value"
              value={value}
              onChange={e => setValue(e.target.value)}
              placeholder="es. CORE"
              disabled={state.mode === 'edit'}
              autoFocus
            />
            {state.mode === 'create' && (
              <p className="text-xs text-muted-foreground">Stringa identificativa, non modificabile dopo la creazione.</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cat-label">Label visualizzata</Label>
            <Input
              id="cat-label"
              value={label}
              onChange={e => setLabel(e.target.value)}
              placeholder="es. Core"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isLoading}>Annulla</Button>
          <Button
            onClick={() => onSubmit({ value: value.trim(), label: label.trim() })}
            disabled={!canSubmit || isLoading}
          >
            {isLoading ? 'Salvataggio…' : state.mode === 'create' ? 'Aggiungi' : 'Salva'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
