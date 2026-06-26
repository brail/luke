'use client';

import { Check, Plus, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { DEPENDENCY_SEVERITY, type DependencySeverity } from '@luke/core';

import { Badge } from '../../../../../components/ui/badge';
import { Button } from '../../../../../components/ui/button';
import { ConfirmDialog } from '../../../../../components/ConfirmDialog';
import { Input } from '../../../../../components/ui/input';
import { Label } from '../../../../../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../../../components/ui/select';
import { Textarea } from '../../../../../components/ui/textarea';
import { trpc } from '../../../../../lib/trpc';
import { getTrpcErrorMessage } from '../../../../../lib/trpcErrorMessages';

interface TemplateItem {
  id: string;
  title: string;
  offsetDays: number;
}

interface TemplateDep {
  id: string;
  predecessorId: string;
  successorId: string;
  severity: string;
  minGapDays: number | null;
  maxGapDays: number | null;
  reason: string | null;
  successor: { id: string; title: string };
}

interface Props {
  items: TemplateItem[];
  dependencies: TemplateDep[];
  readOnly?: boolean;
}

function GapRange({ min, max }: { min: number | null; max: number | null }) {
  if (min === null && max === null) return <span className="text-muted-foreground">—</span>;
  const minStr = min !== null ? `${min}gg` : '0gg';
  const maxStr = max !== null ? `${max}gg` : '∞';
  return <span className="text-xs text-muted-foreground">{minStr} → {maxStr}</span>;
}

function GapViolationBadge({ currentGap, min, max }: { currentGap: number; min: number | null; max: number | null }) {
  const underMin = min !== null && currentGap < min;
  const overMax = max !== null && currentGap > max;
  if (!underMin && !overMax) return null;
  return (
    <span className="text-[10px] text-amber-600 dark:text-amber-400 shrink-0" title={underMin ? `Gap attuale ${currentGap}gg < min ${min}gg` : `Gap attuale ${currentGap}gg > max ${max}gg`}>
      ⚠ {currentGap}gg
    </span>
  );
}

function DepRow({
  dep, predecessorTitle, currentGap, canEdit, onDelete, onUpdateGaps,
}: {
  dep: TemplateDep;
  predecessorTitle: string;
  currentGap: number | null;
  canEdit: boolean;
  onDelete: (id: string) => void;
  onUpdateGaps: (id: string, min: number | undefined, max: number | undefined) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [minVal, setMinVal] = useState(dep.minGapDays !== null ? String(dep.minGapDays) : '');
  const [maxVal, setMaxVal] = useState(dep.maxGapDays !== null ? String(dep.maxGapDays) : '');
  const [deleteTarget, setDeleteTarget] = useState(false);

  useEffect(() => {
    setMinVal(dep.minGapDays !== null ? String(dep.minGapDays) : '');
    setMaxVal(dep.maxGapDays !== null ? String(dep.maxGapDays) : '');
  }, [dep.minGapDays, dep.maxGapDays]);

  const handleSave = () => {
    const min = minVal !== '' ? parseInt(minVal, 10) : undefined;
    const max = maxVal !== '' ? parseInt(maxVal, 10) : undefined;
    onUpdateGaps(dep.id, min, max);
    setEditing(false);
  };

  return (
    <div className="flex items-center gap-2 py-1.5 border-b last:border-b-0">
      <div className="flex-1 min-w-0 flex items-center gap-1 text-sm">
        <span className="truncate text-muted-foreground">{predecessorTitle}</span>
        <span className="text-muted-foreground/50 shrink-0">→</span>
        <span className="truncate">{dep.successor.title}</span>
      </div>
      <Badge variant={dep.severity === 'HARD' ? 'destructive' : 'secondary'} className="text-[10px] shrink-0">
        {dep.severity}
      </Badge>
      {currentGap !== null && (
        <GapViolationBadge currentGap={currentGap} min={dep.minGapDays} max={dep.maxGapDays} />
      )}
      {editing ? (
        <div className="flex items-center gap-1 shrink-0">
          <Input
            type="number" min={0} value={minVal} onChange={e => setMinVal(e.target.value)}
            className="w-16 h-6 text-xs px-1" placeholder="min"
          />
          <span className="text-muted-foreground text-xs">→</span>
          <Input
            type="number" min={0} value={maxVal} onChange={e => setMaxVal(e.target.value)}
            className="w-16 h-6 text-xs px-1" placeholder="max"
          />
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleSave}><Check size={12} /></Button>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setEditing(false)}><X size={12} /></Button>
        </div>
      ) : (
        <button
          type="button"
          onClick={canEdit ? () => setEditing(true) : undefined}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors shrink-0"
        >
          <GapRange min={dep.minGapDays} max={dep.maxGapDays} />
        </button>
      )}
      {canEdit && (
        <Button
          variant="ghost" size="icon"
          className="h-6 w-6 text-muted-foreground hover:text-destructive shrink-0"
          onClick={() => setDeleteTarget(true)}
        >
          <Trash2 size={12} />
        </Button>
      )}
      <ConfirmDialog
        open={deleteTarget}
        onOpenChange={open => { if (!open) setDeleteTarget(false); }}
        title="Elimina dipendenza"
        description={`Sei sicuro di voler eliminare la dipendenza "${predecessorTitle} → ${dep.successor.title}"?`}
        confirmText="Elimina"
        cancelText="Annulla"
        variant="destructive"
        actionType="delete"
        onConfirm={() => onDelete(dep.id)}
      />
    </div>
  );
}

interface AddFormProps {
  items: TemplateItem[];
  existingPairs: Set<string>;
  onSaved: () => void;
  onCancel: () => void;
}

function AddForm({ items, existingPairs, onSaved, onCancel }: AddFormProps) {
  const [predecessorId, setPredecessorId] = useState('');
  const [successorId, setSuccessorId] = useState('');
  const [severity, setSeverity] = useState<DependencySeverity>('SOFT');
  const [minGap, setMinGap] = useState('');
  const [maxGap, setMaxGap] = useState('');
  const [reason, setReason] = useState('');

  const utils = trpc.useUtils();
  const addMutation = trpc.seasonCalendar.addTemplateDependency.useMutation({
    onSuccess: () => {
      void utils.seasonCalendar.listTemplates.invalidate();
      onSaved();
    },
    onError: err => toast.error(getTrpcErrorMessage(err)),
  });

  const availableSuccessors = useMemo(
    () => items.filter(i => i.id !== predecessorId && !existingPairs.has(`${predecessorId}:${i.id}`)),
    [items, predecessorId, existingPairs],
  );

  const handleSubmit = () => {
    if (!predecessorId || !successorId) return;
    addMutation.mutate({
      predecessorId,
      successorId,
      severity,
      minGapDays: minGap !== '' ? parseInt(minGap, 10) : undefined,
      maxGapDays: maxGap !== '' ? parseInt(maxGap, 10) : undefined,
      reason: reason || undefined,
    });
  };

  const predItem = predecessorId ? items.find(i => i.id === predecessorId) : undefined;
  const succItem = successorId ? items.find(i => i.id === successorId) : undefined;
  const currentGap = predItem && succItem ? succItem.offsetDays - predItem.offsetDays : null;
  const minGapNum = minGap !== '' ? parseInt(minGap, 10) : undefined;
  const gapViolated = currentGap !== null && minGapNum !== undefined && currentGap < minGapNum;

  return (
    <div className="mt-3 border rounded-md p-3 bg-muted/10 space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-xs">Predecessore</Label>
          <Select value={predecessorId} onValueChange={v => { setPredecessorId(v); setSuccessorId(''); }}>
            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Seleziona…" /></SelectTrigger>
            <SelectContent>
              {items.map(i => (
                <SelectItem key={i.id} value={i.id}>
                  {i.title} <span className="text-muted-foreground">({i.offsetDays >= 0 ? '+' : ''}{i.offsetDays}gg)</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Successore</Label>
          <Select value={successorId} onValueChange={setSuccessorId} disabled={!predecessorId}>
            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Seleziona…" /></SelectTrigger>
            <SelectContent>
              {availableSuccessors.map(i => (
                <SelectItem key={i.id} value={i.id}>
                  {i.title} <span className="text-muted-foreground">({i.offsetDays >= 0 ? '+' : ''}{i.offsetDays}gg)</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      {currentGap !== null && (
        <p className={`text-xs ${gapViolated ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'}`}>
          Gap attuale: {currentGap}gg {gapViolated ? `⚠ < min ${minGapNum}gg` : ''}
        </p>
      )}
      <div className="grid grid-cols-3 gap-2">
        <div className="space-y-1">
          <Label className="text-xs">Severity</Label>
          <Select value={severity} onValueChange={v => setSeverity(v as DependencySeverity)}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {DEPENDENCY_SEVERITY.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Intervallo min (gg)</Label>
          <Input type="number" min={0} value={minGap} onChange={e => setMinGap(e.target.value)} className="h-8 text-xs" placeholder="0" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Intervallo max (gg)</Label>
          <Input type="number" min={0} value={maxGap} onChange={e => setMaxGap(e.target.value)} className="h-8 text-xs" placeholder="∞" />
        </div>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Motivo (opzionale)</Label>
        <Textarea value={reason} onChange={e => setReason(e.target.value)} className="text-xs min-h-[60px]" placeholder="Descrivi la ragione di questa dipendenza…" />
      </div>
      <div className="flex gap-2 justify-end">
        <Button variant="ghost" size="sm" onClick={onCancel}>Annulla</Button>
        <Button size="sm" onClick={handleSubmit} disabled={!predecessorId || !successorId || addMutation.isPending}>
          Aggiungi
        </Button>
      </div>
    </div>
  );
}

export function TemplateDependencyManager({ items, dependencies, readOnly }: Props) {
  const [showAddForm, setShowAddForm] = useState(false);
  const utils = trpc.useUtils();

  const itemById = useMemo(() => Object.fromEntries(items.map(i => [i.id, i])), [items]);

  const existingPairs = useMemo(
    () => new Set(dependencies.map(d => `${d.predecessorId}:${d.successorId}`)),
    [dependencies],
  );

  const deleteMutation = trpc.seasonCalendar.deleteTemplateDependency.useMutation({
    onSuccess: () => void utils.seasonCalendar.listTemplates.invalidate(),
    onError: err => toast.error(getTrpcErrorMessage(err)),
  });

  const updateGapsMutation = trpc.seasonCalendar.updateTemplateDependencyGaps.useMutation({
    onSuccess: () => void utils.seasonCalendar.listTemplates.invalidate(),
    onError: err => toast.error(getTrpcErrorMessage(err)),
  });

  const handleDelete = (id: string) => deleteMutation.mutate({ id });
  const handleUpdateGaps = (id: string, min: number | undefined, max: number | undefined) =>
    updateGapsMutation.mutate({ id, minGapDays: min, maxGapDays: max });

  return (
    <div className="space-y-2 py-1">
      {dependencies.length === 0 && !showAddForm && (
        <p className="text-sm text-muted-foreground text-center py-3">Nessuna dipendenza — aggiungine una per propagarla automaticamente al calendario.</p>
      )}

      {dependencies.map(dep => {
        const predOffset = itemById[dep.predecessorId]?.offsetDays;
        const succOffset = itemById[dep.successorId]?.offsetDays;
        const currentGap = predOffset !== undefined && succOffset !== undefined ? succOffset - predOffset : null;
        return (
          <DepRow
            key={dep.id}
            dep={dep}
            predecessorTitle={itemById[dep.predecessorId]?.title ?? dep.predecessorId}
            currentGap={currentGap}
            canEdit={!readOnly}
            onDelete={handleDelete}
            onUpdateGaps={handleUpdateGaps}
          />
        );
      })}

      {!readOnly && (
        showAddForm ? (
          <AddForm
            items={items}
            existingPairs={existingPairs}
            onSaved={() => setShowAddForm(false)}
            onCancel={() => setShowAddForm(false)}
          />
        ) : (
          <Button variant="outline" size="sm" className="w-full" onClick={() => setShowAddForm(true)}>
            <Plus size={14} className="mr-1" />Aggiungi dipendenza
          </Button>
        )
      )}
    </div>
  );
}
