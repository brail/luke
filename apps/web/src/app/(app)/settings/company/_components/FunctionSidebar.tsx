'use client';

import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Layers, Pencil, RotateCcw, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { ConfirmDialog } from '../../../../../components/ConfirmDialog';
import { Badge } from '../../../../../components/ui/badge';
import { Button } from '../../../../../components/ui/button';
import { trpc } from '../../../../../lib/trpc';
import { getTrpcErrorMessage } from '../../../../../lib/trpcErrorMessages';
import { cn } from '../../../../../lib/utils';

import { FunctionDialog } from './FunctionDialog';

type CompanyFunction = {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  order: number;
  isActive: boolean;
};

// ── Sortable card ─────────────────────────────────────────────────────────────

interface SortableFunctionCardProps {
  fn: CompanyFunction;
  isSelected: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onRestore: () => void;
  isRestoring?: boolean;
}

/**
 * Drag-and-drop sortable card representing a single company function in the sidebar.
 * Renders a deactivated (dashed, struck-through) variant when `fn.isActive` is false.
 */
function SortableFunctionCard({ fn, isSelected, canUpdate, canDelete, onSelect, onEdit, onDelete, onRestore, isRestoring }: SortableFunctionCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: fn.id,
    disabled: !fn.isActive,
  });
  const style = { transform: CSS.Transform.toString(transform), transition };

  if (!fn.isActive) {
    return (
      <div
        className="group flex cursor-pointer items-start gap-2 rounded-md border border-dashed p-3 text-sm opacity-50 transition-colors hover:opacity-75"
        onClick={onSelect}
      >
        <Layers size={14} className="mt-0.5 shrink-0 text-muted-foreground" />
        <div className="flex-1 min-w-0">
          <span className="truncate font-medium text-muted-foreground line-through">{fn.name}</span>
          <div className="mt-1 flex items-center gap-1.5">
            <Badge variant="outline" className="font-mono text-xs">{fn.slug}</Badge>
            <Badge variant="secondary" className="text-xs">Disattivata</Badge>
          </div>
        </div>
        {canUpdate && (
          <button
            type="button"
            className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-emerald-600 disabled:cursor-not-allowed"
            onClick={e => { e.stopPropagation(); onRestore(); }}
            disabled={isRestoring}
            title="Ripristina funzione"
          >
            <RotateCcw size={12} className={isRestoring ? 'animate-spin' : ''} />
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'group flex cursor-pointer items-start gap-2 rounded-md border p-3 text-sm transition-colors',
        isSelected ? 'border-primary/40 bg-primary/5' : 'hover:bg-muted/50',
        isDragging && 'opacity-50 shadow-lg',
      )}
      onClick={onSelect}
    >
      {canUpdate && (
        <button
          type="button"
          className="mt-0.5 shrink-0 cursor-grab touch-none text-muted-foreground/40 opacity-0 transition-opacity group-hover:opacity-100 active:cursor-grabbing"
          onClick={e => e.stopPropagation()}
          {...attributes}
          {...listeners}
        >
          <GripVertical size={14} />
        </button>
      )}

      <Layers size={14} className={cn('mt-0.5 shrink-0', isSelected ? 'text-primary' : 'text-muted-foreground')} />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className={cn('font-medium truncate', isSelected && 'text-primary')}>{fn.name}</span>
        </div>
        <Badge variant="outline" className="mt-1 font-mono text-xs">{fn.slug}</Badge>
      </div>

      <div className="flex shrink-0 flex-col gap-0.5 opacity-0 transition-opacity group-hover:opacity-100" onClick={e => e.stopPropagation()}>
        {canUpdate && (
          <button type="button" className="rounded p-0.5 text-muted-foreground hover:text-foreground" onClick={onEdit}>
            <Pencil size={12} />
          </button>
        )}
        {canDelete && (
          <button type="button" className="rounded p-0.5 text-muted-foreground hover:text-destructive" onClick={onDelete}>
            <Trash2 size={12} />
          </button>
        )}
      </div>
    </div>
  );
}

// ── FunctionSidebar ───────────────────────────────────────────────────────────

interface FunctionSidebarProps {
  functions: CompanyFunction[];
  selectedId: string | null;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  onSelect: (id: string) => void;
  onRefresh: () => Promise<void>;
}

/**
 * Sidebar listing company functions with drag-and-drop reordering, inline create/edit/delete actions,
 * and soft-delete restore support.
 * @param onRefresh - async callback to reload the function list after a mutation
 */
export function FunctionSidebar({ functions, selectedId, canCreate, canUpdate, canDelete, onSelect, onRefresh }: FunctionSidebarProps) {
  const [items, setItems] = useState(functions);
  const [fnDialog, setFnDialog] = useState<{ open: boolean; fn?: CompanyFunction }>({ open: false });
  const [deleteTarget, setDeleteTarget] = useState<CompanyFunction | null>(null);

  useEffect(() => { setItems(functions); }, [functions]);

  const sensors = useSensors(useSensor(PointerSensor));

  const reorderMutation = trpc.company.function.reorder.useMutation({
    onError: err => { toast.error(getTrpcErrorMessage(err)); setItems(functions); },
  });

  const deactivateMutation = trpc.company.function.delete.useMutation({
    onSuccess: async () => { toast.success('Funzione disattivata'); await onRefresh(); },
    onError: err => toast.error(getTrpcErrorMessage(err)),
  });

  const restoreMutation = trpc.company.function.restore.useMutation({
    onSuccess: async () => { toast.success('Funzione ripristinata'); await onRefresh(); },
    onError: err => toast.error(getTrpcErrorMessage(err)),
  });

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = items.findIndex(f => f.id === active.id);
    const newIndex = items.findIndex(f => f.id === over.id);
    const newItems = arrayMove(items, oldIndex, newIndex);
    setItems(newItems);
    reorderMutation.mutate({ orderedIds: newItems.map(f => f.id) });
  };

  return (
    <div className="flex flex-col gap-2">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={items.map(f => f.id)} strategy={verticalListSortingStrategy}>
          {items.map(fn => (
            <SortableFunctionCard
              key={fn.id}
              fn={fn}
              isSelected={fn.id === selectedId}
              canUpdate={canUpdate}
              canDelete={canDelete}
              onSelect={() => onSelect(fn.id)}
              onEdit={() => setFnDialog({ open: true, fn })}
              onDelete={() => setDeleteTarget(fn)}
              onRestore={() => restoreMutation.mutate({ id: fn.id })}
              isRestoring={restoreMutation.isPending && restoreMutation.variables?.id === fn.id}
            />
          ))}
        </SortableContext>
      </DndContext>

      {items.length === 0 && (
        <p className="py-4 text-center text-xs text-muted-foreground">
          Nessuna funzione aziendale
        </p>
      )}

      {canCreate && (
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start text-muted-foreground hover:text-foreground"
          onClick={() => setFnDialog({ open: true })}
        >
          + Nuova funzione
        </Button>
      )}

      <FunctionDialog
        open={fnDialog.open}
        fn={fnDialog.fn}
        onClose={() => setFnDialog({ open: false })}
        onSaved={async () => { setFnDialog({ open: false }); await onRefresh(); }}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={open => { if (!open) setDeleteTarget(null); }}
        title="Disattiva funzione"
        description={`Sei sicuro di voler disattivare "${deleteTarget?.name}"? I team associati rimarranno, ma la funzione non sarà più visibile.`}
        confirmText="Disattiva"
        cancelText="Annulla"
        variant="destructive"
        actionType="disable"
        onConfirm={() => { if (deleteTarget) deactivateMutation.mutate({ id: deleteTarget.id }); }}
        isLoading={deactivateMutation.isPending}
      />
    </div>
  );
}
