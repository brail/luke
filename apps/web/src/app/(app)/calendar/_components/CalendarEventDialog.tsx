'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { CALENDAR_EVENT_STATUS } from '@luke/core';

import { ConfirmDialog } from '../../../../components/ConfirmDialog';
import { Badge } from '../../../../components/ui/badge';
import { Button } from '../../../../components/ui/button';
import { Checkbox } from '../../../../components/ui/checkbox';
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../../components/ui/select';
import { Textarea } from '../../../../components/ui/textarea';
import { trpc } from '../../../../lib/trpc';
import { getTrpcErrorMessage } from '../../../../lib/trpcErrorMessages';
import { STATUS_LABELS, STATUS_VARIANT, TYPE_LABELS } from '../constants';
import { daysBetween, describeAnchorScope } from '../utils';

interface ExistingEvent {
  id: string;
  title: string;
  description?: string | null;
  startAt: Date | string;
  endAt?: Date | string | null;
  baselineStartAt?: Date | string | null;
  baselineEndAt?: Date | string | null;
  allDay: boolean;
  status: string;
  type: string;
  ownerFunctionId: string;
  publishExternally: boolean;
  visibilities: { functionId: string }[];
  anchors?: { entityType: string; entityId: string }[];
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  calendarId: string;
  availableFunctions: { id: string; name: string }[];
  functionsById?: Record<string, string>;
  event?: ExistingEvent;
  defaultDate?: string;
  defaultAllDay?: boolean;
  readOnly?: boolean;
  onDeleted?: () => void;
}

function toDateInput(val: Date | string | null | undefined): string {
  if (!val) return '';
  const d = new Date(val);
  return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`;
}

function toTimeInput(val: Date | string | null | undefined): string {
  if (!val) return '09:00';
  const d = new Date(val);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

function buildIso(date: string, time: string): string {
  return new Date(`${date}T${time}:00`).toISOString();
}

function addOneHour(time: string): string {
  const [h, m] = time.split(':').map(Number);
  return `${((h + 1) % 24).toString().padStart(2, '0')}:${(m ?? 0).toString().padStart(2, '0')}`;
}

// TODO(Fase5): motore alert avrà bisogno dello stesso calcolo di scostamento lato server —
// se estratto in helper condiviso, mantenere identica la semantica di arrotondamento (daysBetween).
/** Days elapsed between the frozen baseline start and the current start, or null if not frozen / unchanged. */
function describeBaselineDrift(event: ExistingEvent): string | null {
  if (!event.baselineStartAt) return null;
  const diff = daysBetween(new Date(event.baselineStartAt), new Date(event.startAt));
  if (diff === 0) return null;
  return diff > 0 ? `Spostato di ${diff}g rispetto al piano originale` : `Anticipato di ${-diff}g rispetto al piano originale`;
}

/**
 * Dialog for creating or editing a calendar milestone/event.
 *
 * In edit and create mode the dialog shows a single "Dettagli" form.
 * In read-only mode it renders a compact information card with no form fields.
 *
 * @param calendarId - Parent season calendar ID (used only in create mode).
 * @param availableFunctions - Company functions available as owner/visibility targets.
 * @param functionsById - Map of function ID → name for display in read-only mode.
 * @param event - Existing event to edit; omit for create mode.
 * @param defaultDate - ISO date pre-filled in the start-date field on create.
 * @param readOnly - When true renders a read-only info card instead of the form.
 * @param onDeleted - Called after the event is successfully deleted.
 */
export function CalendarEventDialog({
  open, onClose, onSaved, calendarId, availableFunctions, functionsById = {},
  event, defaultDate, defaultAllDay = true, readOnly = false, onDeleted,
}: Props) {
  const isEdit = !!event;

  const { data: catalogItems = [] } = trpc.calendarCatalog.list.useQuery(
    { type: 'eventType' },
    { staleTime: 5 * 60 * 1000 }
  );

  const [title, setTitle] = useState(event?.title ?? '');
  const [description, setDescription] = useState(event?.description ?? '');
  const [type, setType] = useState<string>(event?.type ?? 'MILESTONE');
  const [status, setStatus] = useState<(typeof CALENDAR_EVENT_STATUS)[number]>((event?.status as (typeof CALENDAR_EVENT_STATUS)[number]) ?? 'PLANNED');
  const [ownerFunctionId, setOwnerFunctionId] = useState<string>(event?.ownerFunctionId ?? availableFunctions[0]?.id ?? '');
  const [visibilityFunctionIds, setVisibilityFunctionIds] = useState<string[]>(() => {
    const owner = event?.ownerFunctionId ?? availableFunctions[0]?.id ?? '';
    return event ? event.visibilities.map(v => v.functionId) : (owner ? [owner] : []);
  });
  const [startDate, setStartDate] = useState(() => toDateInput(event?.startAt ?? defaultDate));
  const [startTime, setStartTime] = useState(() => event ? toTimeInput(event.startAt) : (defaultAllDay ? '09:00' : toTimeInput(defaultDate)));
  const [endDate, setEndDate] = useState(() => {
    const sd = toDateInput(event?.startAt ?? defaultDate);
    return event?.endAt ? toDateInput(event.endAt) : sd;
  });
  const [endTime, setEndTime] = useState(() => {
    const st = event ? toTimeInput(event.startAt) : (defaultAllDay ? '09:00' : toTimeInput(defaultDate));
    return event?.endAt ? toTimeInput(event.endAt) : addOneHour(st);
  });
  const [allDay, setAllDay] = useState(event?.allDay ?? defaultAllDay);
  const [publishExternally, setPublishExternally] = useState(event?.publishExternally ?? true);
  const [deleteOpen, setDeleteOpen] = useState(false);

  useEffect(() => {
    setTitle(event?.title ?? '');
    setDescription(event?.description ?? '');
    setType(event?.type ?? 'MILESTONE');
    setStatus((event?.status as (typeof CALENDAR_EVENT_STATUS)[number]) ?? 'PLANNED');
    const owner = event?.ownerFunctionId ?? availableFunctions[0]?.id ?? '';
    setOwnerFunctionId(owner);
    setVisibilityFunctionIds(event ? event.visibilities.map(v => v.functionId) : (owner ? [owner] : []));
    const sd = toDateInput(event?.startAt ?? defaultDate);
    const st = event ? toTimeInput(event.startAt) : (defaultAllDay ? '09:00' : toTimeInput(defaultDate));
    setStartDate(sd);
    setStartTime(st);
    setEndDate(event?.endAt ? toDateInput(event.endAt) : sd);
    setEndTime(event?.endAt ? toTimeInput(event.endAt) : addOneHour(st));
    setAllDay(event?.allDay ?? defaultAllDay);
    setPublishExternally(event?.publishExternally ?? true);
  }, [event?.id, open, defaultDate]);

  const handleOwnerChange = (val: string) => {
    setOwnerFunctionId(val);
    setVisibilityFunctionIds(prev => prev.includes(val) ? prev : [...prev, val]);
  };

  const toggleVisible = (fnId: string) => {
    if (fnId === ownerFunctionId) return;
    setVisibilityFunctionIds(prev =>
      prev.includes(fnId) ? prev.filter(k => k !== fnId) : [...prev, fnId]
    );
  };

  const createMutation = trpc.seasonCalendar.createMilestone.useMutation({
    onSuccess: () => { toast.success('Evento creato'); onSaved(); onClose(); },
    onError: err => toast.error(getTrpcErrorMessage(err)),
  });

  const updateMutation = trpc.seasonCalendar.updateMilestone.useMutation({
    onSuccess: () => { toast.success('Evento aggiornato'); onSaved(); onClose(); },
    onError: err => toast.error(getTrpcErrorMessage(err)),
  });

  const deleteMutation = trpc.seasonCalendar.deleteMilestone.useMutation({
    onSuccess: () => {
      toast.success('Evento eliminato');
      setDeleteOpen(false);
      onClose();
      onDeleted?.();
    },
    onError: err => toast.error(getTrpcErrorMessage(err)),
  });

  const isPending = createMutation.isPending || updateMutation.isPending;

  const handleSubmit = () => {
    if (!title.trim() || !startDate) {
      toast.error('Titolo e data di inizio sono obbligatori');
      return;
    }
    if (visibilityFunctionIds.length === 0) {
      toast.error('Seleziona almeno una funzione visibile');
      return;
    }
    const startIso = allDay ? buildIso(startDate, '00:00') : buildIso(startDate, startTime);
    const endIso = endDate ? (allDay ? buildIso(endDate, '00:00') : buildIso(endDate, endTime)) : undefined;

    const payload = {
      title: title.trim(),
      description: description.trim() || undefined,
      type,
      status,
      ownerFunctionId,
      visibilityFunctionIds,
      startAt: startIso,
      endAt: endIso,
      allDay,
      publishExternally,
    };

    if (isEdit) {
      updateMutation.mutate({ id: event.id, data: payload });
    } else {
      createMutation.mutate({ calendarId, ...payload });
    }
  };

  if (readOnly && event) {
    const dateStr = new Date(event.startAt).toLocaleDateString('it-IT', {
      weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
    });
    const timeStr = !event.allDay
      ? new Date(event.startAt).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
      : null;
    const typeLabel = catalogItems.find(c => c.value === event.type)?.label ?? TYPE_LABELS[event.type] ?? event.type;
    const baselineDrift = describeBaselineDrift(event);
    return (
      <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle className="leading-snug">{event.title}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="flex flex-wrap gap-1.5">
              <Badge variant="outline">{typeLabel}</Badge>
              <Badge variant={STATUS_VARIANT[event.status] ?? 'outline'}>{STATUS_LABELS[event.status] ?? event.status}</Badge>
              <Badge variant="secondary">{functionsById[event.ownerFunctionId] ?? event.ownerFunctionId}</Badge>
              <Badge variant="outline" className="text-muted-foreground">Ambito: {describeAnchorScope(event.anchors)}</Badge>
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground mb-1">Data</p>
              <p className="text-sm capitalize">{dateStr}{timeStr ? ` · ${timeStr}` : ''}</p>
              {event.endAt && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  → {new Date(event.endAt).toLocaleDateString('it-IT')}
                  {!event.allDay && ` · ${new Date(event.endAt).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}`}
                </p>
              )}
              {baselineDrift && (
                <Badge variant="outline" className="mt-1.5 text-xs text-amber-700 border-amber-300 bg-amber-50">
                  {baselineDrift}
                </Badge>
              )}
            </div>
            {event.description && (
              <div>
                <p className="text-sm font-medium text-muted-foreground mb-1">Descrizione</p>
                <p className="text-sm whitespace-pre-wrap">{event.description}</p>
              </div>
            )}
            <div>
              <p className="text-sm font-medium text-muted-foreground mb-1">Visibile a</p>
              <div className="flex flex-wrap gap-1">
                {event.visibilities.map(v => (
                  <Badge key={v.functionId} variant="outline" className="text-xs">
                    {functionsById[v.functionId] ?? v.functionId}
                  </Badge>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>Chiudi</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  const editFormBaselineDrift = event ? describeBaselineDrift(event) : null;

  return (
    <>
      <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
        <DialogContent className="sm:max-w-[520px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{isEdit ? 'Modifica evento' : 'Nuovo evento'}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="ev-title">Titolo *</Label>
              <Input id="ev-title" value={title} onChange={e => setTitle(e.target.value)} placeholder="Nome dell'evento" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Tipo</Label>
                <Select value={type} onValueChange={setType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {catalogItems.map(item => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Stato</Label>
                <Select value={status} onValueChange={v => setStatus(v as (typeof CALENDAR_EVENT_STATUS)[number])}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CALENDAR_EVENT_STATUS.map(s => <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Owner *</Label>
              <Select value={ownerFunctionId} onValueChange={handleOwnerChange}>
                <SelectTrigger><SelectValue placeholder="Seleziona funzione…" /></SelectTrigger>
                <SelectContent>
                  {availableFunctions.map(fn => <SelectItem key={fn.id} value={fn.id}>{fn.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Visibile a</Label>
              <div className="flex flex-wrap gap-3">
                {availableFunctions.map(fn => (
                  <label key={fn.id} className="flex items-center gap-1.5 cursor-pointer">
                    <Checkbox checked={visibilityFunctionIds.includes(fn.id)} disabled={fn.id === ownerFunctionId} onCheckedChange={() => toggleVisible(fn.id)} />
                    <span className="text-sm">{fn.name}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Checkbox id="ev-allday" checked={allDay} onCheckedChange={v => setAllDay(!!v)} />
              <Label htmlFor="ev-allday" className="cursor-pointer font-normal">Tutto il giorno</Label>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="ev-start-date">Inizio *</Label>
                <Input id="ev-start-date" type="date" value={startDate}
                  onChange={e => { setStartDate(e.target.value); if (!endDate) setEndDate(e.target.value); }}
                  className="[&::-webkit-datetime-edit-fields-wrapper]:text-muted-foreground" />
                {!allDay && (
                  <Input type="time" value={startTime}
                    onChange={e => { setStartTime(e.target.value); setEndTime(addOneHour(e.target.value)); }}
                    className="[&::-webkit-datetime-edit-fields-wrapper]:text-muted-foreground" />
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ev-end-date">Fine</Label>
                <Input id="ev-end-date" type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
                  className="[&::-webkit-datetime-edit-fields-wrapper]:text-muted-foreground" />
                {!allDay && (
                  <Input type="time" value={endTime} onChange={e => setEndTime(e.target.value)}
                    className="[&::-webkit-datetime-edit-fields-wrapper]:text-muted-foreground" />
                )}
              </div>
            </div>

            {editFormBaselineDrift && (
              <Badge variant="outline" className="text-xs text-amber-700 border-amber-300 bg-amber-50">
                {editFormBaselineDrift}
              </Badge>
            )}

            <div className="flex items-center gap-2">
              <Checkbox id="ev-publish" checked={publishExternally} onCheckedChange={v => setPublishExternally(!!v)} />
              <Label htmlFor="ev-publish" className="cursor-pointer font-normal">Pubblica su Google Calendar</Label>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="ev-desc">Descrizione</Label>
              <Textarea id="ev-desc" value={description} onChange={e => setDescription(e.target.value)}
                placeholder="Note opzionali…" className="resize-none text-sm" rows={3} />
            </div>
          </div>

          <DialogFooter className="gap-2">
            {isEdit && onDeleted && (
              <Button variant="destructive" onClick={() => setDeleteOpen(true)} disabled={isPending} className="mr-auto">
                Elimina
              </Button>
            )}
            <Button variant="outline" onClick={onClose} disabled={isPending}>Annulla</Button>
            <Button onClick={handleSubmit} disabled={isPending}>
              {isPending ? 'Salvataggio…' : isEdit ? 'Salva' : 'Crea'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {isEdit && (
        <ConfirmDialog
          open={deleteOpen}
          onOpenChange={v => { if (!v) setDeleteOpen(false); }}
          title="Elimina evento"
          description={`Sei sicuro di voler eliminare "${event.title}"? Questa operazione è irreversibile.`}
          confirmText="Elimina"
          cancelText="Annulla"
          variant="destructive"
          actionType="delete"
          onConfirm={() => deleteMutation.mutate({ id: event.id })}
          isLoading={deleteMutation.isPending}
        />
      )}
    </>
  );
}
