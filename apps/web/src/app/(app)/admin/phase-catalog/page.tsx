'use client';

import { ArrowDown, ArrowUp, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

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

type PhaseItem = {
  id: string;
  value: string;
  label: string;
  code: string | null;
  order: number;
  isActive: boolean;
};

type ItemDialogState = { mode: 'create' } | { mode: 'edit'; item: PhaseItem };

/**
 * Admin page for the unified Phase catalog — replaces the parallel
 * CollectionCatalogItem(type=progress) and CalendarCatalogItem(type=eventType) domains
 * with a single ordered list used both by collection rows and calendar events/milestones.
 */
export default function PhaseCatalogPage() {
  const { can } = usePermission();
  const canWrite = can('phase_catalog:update');

  const [itemDialog, setItemDialog] = useState<ItemDialogState | null>(null);
  const [deletingItem, setDeletingItem] = useState<PhaseItem | null>(null);

  const utils = trpc.useUtils();
  const invalidate = () => {
    void utils.phase.listAll.invalidate();
    void utils.phase.list.invalidate();
  };

  const { data: items = [], isLoading } = trpc.phase.listAll.useQuery(undefined, {
    staleTime: 30 * 1000,
  });

  const createMutation = trpc.phase.create.useMutation({
    onSuccess: () => { invalidate(); setItemDialog(null); toast.success('Fase aggiunta'); },
    onError: e => toast.error(getTrpcErrorMessage(e, { CONFLICT: 'Valore già esistente' })),
  });

  const updateMutation = trpc.phase.update.useMutation({
    onSuccess: () => { invalidate(); setItemDialog(null); toast.success('Fase aggiornata'); },
    onError: e => toast.error(getTrpcErrorMessage(e)),
  });

  const removeMutation = trpc.phase.remove.useMutation({
    onSuccess: () => { invalidate(); setDeletingItem(null); toast.success('Fase disattivata'); },
    onError: e => toast.error(getTrpcErrorMessage(e)),
  });

  const restoreMutation = trpc.phase.restore.useMutation({
    onSuccess: () => { invalidate(); toast.success('Fase riattivata'); },
    onError: e => toast.error(getTrpcErrorMessage(e)),
  });

  const reorderMutation = trpc.phase.reorder.useMutation({
    onSuccess: () => invalidate(),
    onError: e => toast.error(getTrpcErrorMessage(e)),
  });

  const isMutating =
    createMutation.isPending || updateMutation.isPending || removeMutation.isPending;

  const sortedItems = [...(items as PhaseItem[])].sort((a, b) => a.order - b.order);

  const moveItem = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= sortedItems.length) return;
    const reordered = [...sortedItems];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    reorderMutation.mutate({ orderedIds: reordered.map(i => i.id) });
  };

  return (
    <>
      <PageHeader
        title="Catalogo Fasi"
        description="Ordinamento unificato delle fasi di produzione/calendario, condiviso tra Collection Layout e Calendario"
      />

      <div className="p-6">
        <div className="flex items-center justify-end mb-4">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Button
                    size="sm"
                    disabled={!canWrite}
                    className={!canWrite ? 'opacity-50 cursor-not-allowed' : undefined}
                    onClick={() => canWrite && setItemDialog({ mode: 'create' })}
                  >
                    <Plus className="mr-1 h-4 w-4" />
                    Aggiungi fase
                  </Button>
                </span>
              </TooltipTrigger>
              {!canWrite && (
                <TooltipContent>Non hai i permessi per modificare il catalogo fasi</TooltipContent>
              )}
            </Tooltip>
          </TooltipProvider>
        </div>

        <div className="rounded-lg border bg-card">
          {isLoading ? (
            <div className="p-8 text-center text-sm text-muted-foreground">Caricamento…</div>
          ) : sortedItems.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              Nessuna fase configurata. Aggiungi la prima.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="w-16 px-3 py-2" />
                  <th className="px-3 py-2 text-left font-medium">Valore (chiave)</th>
                  <th className="px-3 py-2 text-left font-medium">Codice</th>
                  <th className="px-3 py-2 text-left font-medium">Label</th>
                  <th className="px-3 py-2 text-left font-medium">Stato</th>
                  <th className="w-24 px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {sortedItems.map((item, index) => (
                  <tr key={item.id} className={cn('border-b last:border-0', !item.isActive && 'opacity-50')}>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-0.5">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-6 w-6"
                          disabled={!canWrite || index === 0 || reorderMutation.isPending}
                          onClick={() => moveItem(index, -1)}
                        >
                          <ArrowUp className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-6 w-6"
                          disabled={!canWrite || index === sortedItems.length - 1 || reorderMutation.isPending}
                          onClick={() => moveItem(index, 1)}
                        >
                          <ArrowDown className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{item.value}</td>
                    <td className="px-3 py-2 font-mono text-xs">{item.code ?? '—'}</td>
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
                                    size="icon-sm"
                                    variant="ghost"
                                    className={!canWrite ? 'opacity-50 cursor-not-allowed' : undefined}
                                    disabled={!canWrite || restoreMutation.isPending}
                                    onClick={() => canWrite && restoreMutation.mutate({ id: item.id })}
                                  >
                                    <RotateCcw className="h-3.5 w-3.5" />
                                  </Button>
                                </span>
                              </TooltipTrigger>
                              {!canWrite && <TooltipContent>Non hai i permessi per modificare il catalogo fasi</TooltipContent>}
                            </Tooltip>
                          </TooltipProvider>
                        ) : (
                          <>
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span>
                                    <Button
                                      size="icon-sm"
                                      variant="ghost"
                                      className={!canWrite ? 'opacity-50 cursor-not-allowed' : undefined}
                                      disabled={!canWrite || isMutating}
                                      onClick={() => canWrite && setItemDialog({ mode: 'edit', item })}
                                    >
                                      <Pencil className="h-3.5 w-3.5" />
                                    </Button>
                                  </span>
                                </TooltipTrigger>
                                {!canWrite && <TooltipContent>Non hai i permessi per modificare il catalogo fasi</TooltipContent>}
                              </Tooltip>
                            </TooltipProvider>

                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span>
                                    <Button
                                      size="icon-sm"
                                      variant="ghost"
                                      className={cn('text-destructive', !canWrite && 'opacity-50 cursor-not-allowed')}
                                      disabled={!canWrite || isMutating}
                                      onClick={() => canWrite && setDeletingItem(item)}
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </Button>
                                  </span>
                                </TooltipTrigger>
                                {!canWrite && <TooltipContent>Non hai i permessi per modificare il catalogo fasi</TooltipContent>}
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
      </div>

      {itemDialog && (
        <PhaseItemDialog
          state={itemDialog}
          onClose={() => setItemDialog(null)}
          onSubmit={(data) => {
            if (itemDialog.mode === 'create') {
              createMutation.mutate(data);
            } else {
              updateMutation.mutate({ id: itemDialog.item.id, data });
            }
          }}
          isLoading={createMutation.isPending || updateMutation.isPending}
        />
      )}

      <ConfirmDialog
        open={!!deletingItem}
        onOpenChange={open => { if (!open) setDeletingItem(null); }}
        title="Disattiva fase"
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

type DialogSubmitData = { value: string; label: string; code?: string | null };

function PhaseItemDialog({
  state,
  onClose,
  onSubmit,
  isLoading,
}: {
  state: ItemDialogState;
  onClose: () => void;
  onSubmit: (data: DialogSubmitData) => void;
  isLoading: boolean;
}) {
  const initial = state.mode === 'edit' ? state.item : null;

  const [value, setValue] = useState(initial?.value ?? '');
  const [label, setLabel] = useState(initial?.label ?? '');
  const [code, setCode] = useState(initial?.code ?? '');

  const canSubmit = value.trim().length > 0 && label.trim().length > 0;

  const handleSubmit = () => {
    onSubmit({
      value: value.trim(),
      label: label.trim(),
      code: code.trim() || null,
    });
  };

  return (
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{state.mode === 'create' ? 'Aggiungi fase' : 'Modifica fase'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="phase-value">Valore (chiave)</Label>
            <Input
              id="phase-value"
              value={value}
              onChange={e => setValue(e.target.value)}
              placeholder="es. DESIGN"
              disabled={state.mode === 'edit'}
              autoFocus
            />
            {state.mode === 'create' && (
              <p className="text-xs text-muted-foreground">Stringa identificativa, non modificabile dopo la creazione.</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="phase-label">Label visualizzata</Label>
            <Input
              id="phase-label"
              value={label}
              onChange={e => setLabel(e.target.value)}
              placeholder="es. Design"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="phase-code">Codice (es. 01)</Label>
            <Input
              id="phase-code"
              value={code}
              onChange={e => setCode(e.target.value)}
              placeholder="es. 01"
              maxLength={10}
            />
            <p className="text-xs text-muted-foreground">Mostrato come "{code || '01'} — {label || 'Label'}"</p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isLoading}>Annulla</Button>
          <Button onClick={handleSubmit} disabled={!canSubmit || isLoading}>
            {isLoading ? 'Salvataggio…' : state.mode === 'create' ? 'Aggiungi' : 'Salva'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
