'use client';

import { Check, Plus, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { Badge } from '../../../../components/ui/badge';
import { Button } from '../../../../components/ui/button';
import { ConfirmDialog } from '../../../../components/ConfirmDialog';
import { Input } from '../../../../components/ui/input';
import { Label } from '../../../../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../../components/ui/select';
import { Textarea } from '../../../../components/ui/textarea';
import { trpc } from '../../../../lib/trpc';
import { getTrpcErrorMessage } from '../../../../lib/trpcErrorMessages';
import { DEPENDENCY_SEVERITY, type DependencySeverity } from '@luke/core';
import { type CalendarEventItem as CalendarEvent } from './types';

interface Dep {
  id: string;
  predecessorId: string;
  successorId: string;
  severity: string;
  minGapDays: number | null;
  maxGapDays: number | null;
  isDisabled: boolean;
  inheritedFromId: string | null;
}

interface Props {
  eventId: string;
  calendarId: string;
  allEvents: CalendarEvent[];
  readOnly?: boolean;
}

function GapRange({ min, max }: { min: number | null; max: number | null }) {
  if (min === null && max === null) return <span className="text-muted-foreground">—</span>;
  const minStr = min !== null ? `${min}gg` : '0gg';
  const maxStr = max !== null ? `${max}gg` : '∞';
  return <span className="text-xs text-muted-foreground">{minStr} → {maxStr}</span>;
}

function DepRow({
  dep, otherEvent, canDelete, onDelete, onUpdateGaps,
}: {
  dep: Dep;
  otherEvent: CalendarEvent | undefined;
  canDelete: boolean;
  onDelete: (id: string) => void;
  onUpdateGaps: (id: string, min: number | undefined, max: number | undefined) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [minVal, setMinVal] = useState(dep.minGapDays !== null ? String(dep.minGapDays) : '');
  const [maxVal, setMaxVal] = useState(dep.maxGapDays !== null ? String(dep.maxGapDays) : '');

  useEffect(() => {
    setMinVal(dep.minGapDays !== null ? String(dep.minGapDays) : '');
    setMaxVal(dep.maxGapDays !== null ? String(dep.maxGapDays) : '');
  }, [dep.minGapDays, dep.maxGapDays]);
  const [deleteTarget, setDeleteTarget] = useState(false);

  const handleSave = () => {
    const min = minVal !== '' ? parseInt(minVal, 10) : undefined;
    const max = maxVal !== '' ? parseInt(maxVal, 10) : undefined;
    onUpdateGaps(dep.id, min, max);
    setEditing(false);
  };

  return (
    <div className="flex items-center gap-2 py-1.5 border-b last:border-b-0">
      <div className="flex-1 min-w-0">
        <span className="text-sm truncate block">{otherEvent?.title ?? dep.predecessorId}</span>
      </div>
      <Badge variant={dep.severity === 'HARD' ? 'destructive' : 'secondary'} className="text-[10px] shrink-0">
        {dep.severity}
      </Badge>
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
          onClick={() => !dep.isDisabled && setEditing(true)}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors shrink-0"
        >
          <GapRange min={dep.minGapDays} max={dep.maxGapDays} />
        </button>
      )}
      {canDelete && (
        <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-destructive shrink-0" onClick={() => setDeleteTarget(true)}>
          <Trash2 size={12} />
        </Button>
      )}
      <ConfirmDialog
        open={deleteTarget}
        onOpenChange={open => { if (!open) setDeleteTarget(false); }}
        title="Elimina dipendenza"
        description="Sei sicuro di voler eliminare questa dipendenza? L'operazione è irreversibile."
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
  eventId: string;
  allEvents: CalendarEvent[];
  existingIds: Set<string>;
  onSaved: () => void;
  onCancel: () => void;
}

function AddForm({ eventId, allEvents, existingIds, onSaved, onCancel }: AddFormProps) {
  const [role, setRole] = useState<'predecessor' | 'successor'>('predecessor');
  const [targetId, setTargetId] = useState('');
  const [severity, setSeverity] = useState<DependencySeverity>('SOFT');
  const [minGap, setMinGap] = useState('');
  const [maxGap, setMaxGap] = useState('');
  const [reason, setReason] = useState('');

  const addMutation = trpc.seasonCalendar.addDependency.useMutation({
    onSuccess: () => { onSaved(); },
    onError: err => toast.error(getTrpcErrorMessage(err)),
  });

  const available = allEvents.filter(e => e.id !== eventId && !existingIds.has(e.id));

  const handleSubmit = () => {
    if (!targetId) return;
    const predecessorId = role === 'predecessor' ? eventId : targetId;
    const successorId = role === 'predecessor' ? targetId : eventId;
    addMutation.mutate({
      predecessorId,
      successorId,
      severity,
      minGapDays: minGap !== '' ? parseInt(minGap, 10) : undefined,
      maxGapDays: maxGap !== '' ? parseInt(maxGap, 10) : undefined,
      reason: reason || undefined,
    });
  };

  return (
    <div className="mt-3 border rounded-md p-3 bg-muted/10 space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-xs">Ruolo di questo evento</Label>
          <Select value={role} onValueChange={v => setRole(v as 'predecessor' | 'successor')}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="predecessor">Predecessore</SelectItem>
              <SelectItem value="successor">Successore</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Evento collegato</Label>
          <Select value={targetId} onValueChange={setTargetId}>
            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Seleziona…" /></SelectTrigger>
            <SelectContent>
              {available.map(e => <SelectItem key={e.id} value={e.id}>{e.title}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
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
          <Label className="text-xs">Min gap (gg)</Label>
          <Input type="number" min={0} value={minGap} onChange={e => setMinGap(e.target.value)} className="h-8 text-xs" placeholder="0" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Max gap (gg)</Label>
          <Input type="number" min={0} value={maxGap} onChange={e => setMaxGap(e.target.value)} className="h-8 text-xs" placeholder="∞" />
        </div>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Motivo (opzionale)</Label>
        <Textarea value={reason} onChange={e => setReason(e.target.value)} className="text-xs min-h-[60px]" placeholder="Descrivi la ragione di questa dipendenza…" />
      </div>
      <div className="flex gap-2 justify-end">
        <Button variant="ghost" size="sm" onClick={onCancel}>Annulla</Button>
        <Button size="sm" onClick={handleSubmit} disabled={!targetId || addMutation.isPending}>Aggiungi</Button>
      </div>
    </div>
  );
}

export function DependencyManager({ eventId, calendarId, allEvents, readOnly }: Props) {
  const [showAddForm, setShowAddForm] = useState(false);

  const { data: allDeps = [], refetch } = trpc.seasonCalendar.getDependencies.useQuery(
    { calendarId },
    { enabled: !!calendarId, staleTime: 30_000 },
  );

  const deleteMutation = trpc.seasonCalendar.deleteDependency.useMutation({
    onSuccess: () => void refetch(),
    onError: err => toast.error(getTrpcErrorMessage(err)),
  });

  const updateGapsMutation = trpc.seasonCalendar.updateDependencyGaps.useMutation({
    onSuccess: () => void refetch(),
    onError: err => toast.error(getTrpcErrorMessage(err)),
  });

  const predecessorDeps = allDeps.filter(d => d.successorId === eventId);
  const successorDeps = allDeps.filter(d => d.predecessorId === eventId);

  const existingLinkedIds = new Set([
    ...predecessorDeps.map(d => d.predecessorId),
    ...successorDeps.map(d => d.successorId),
  ]);

  const eventById = useMemo(() => Object.fromEntries(allEvents.map(e => [e.id, e])), [allEvents]);

  const handleDelete = (id: string) => deleteMutation.mutate({ id });
  const handleUpdateGaps = (id: string, min: number | undefined, max: number | undefined) =>
    updateGapsMutation.mutate({ id, minGapDays: min, maxGapDays: max });

  return (
    <div className="space-y-4 py-1">
      {predecessorDeps.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1 uppercase tracking-wide">Predecessori</p>
          {predecessorDeps.map(dep => (
            <DepRow
              key={dep.id}
              dep={dep}
              otherEvent={eventById[dep.predecessorId]}
              canDelete={!readOnly && !dep.inheritedFromId}
              onDelete={handleDelete}
              onUpdateGaps={handleUpdateGaps}
            />
          ))}
        </div>
      )}

      {successorDeps.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1 uppercase tracking-wide">Successori</p>
          {successorDeps.map(dep => (
            <DepRow
              key={dep.id}
              dep={dep}
              otherEvent={eventById[dep.successorId]}
              canDelete={!readOnly && !dep.inheritedFromId}
              onDelete={handleDelete}
              onUpdateGaps={handleUpdateGaps}
            />
          ))}
        </div>
      )}

      {predecessorDeps.length === 0 && successorDeps.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-4">Nessuna dipendenza configurata</p>
      )}

      {!readOnly && (
        showAddForm ? (
          <AddForm
            eventId={eventId}
            allEvents={allEvents}
            existingIds={existingLinkedIds}
            onSaved={() => { setShowAddForm(false); void refetch(); }}
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
