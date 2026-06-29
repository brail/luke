'use client';

import { AlertTriangle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { CALENDAR_EVENT_STATUS, COLLECTION_PROGRESS, EVENT_SEVERITY, RELEVANT_COUNTRY_CODES, type EventSeverity, type RelevantCountryCode } from '@luke/core';

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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../../../components/ui/tabs';
import { Textarea } from '../../../../components/ui/textarea';
import { trpc } from '../../../../lib/trpc';
import { getTrpcErrorMessage } from '../../../../lib/trpcErrorMessages';
import { SEVERITY_LABELS, STATUS_LABELS, STATUS_VARIANT, TYPE_LABELS } from '../constants';

import { DependencyManager } from './DependencyManager';
import { type CalendarEventItem } from './types';

interface ExistingEvent {
  id: string;
  title: string;
  description?: string | null;
  startAt: Date | string;
  endAt?: Date | string | null;
  allDay: boolean;
  status: string;
  type: string;
  ownerFunctionId: string;
  publishExternally: boolean;
  visibilities: { functionId: string }[];
  severity?: EventSeverity | null;
  relevantCountries?: string[];
  requiredCollectionProgress?: string | null;
  progressWarningDays?: number | null;
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
  allEvents?: CalendarEventItem[];
}

const COLLECTION_PROGRESS_LABELS: Record<string, string> = {
  DESIGN:           'Fase di design',
  CONSTRUCTION_OK:  'Construction OK',
  MODELLERIA_OK:    'Modelleria OK',
  RENDERING:        'Rendering',
  SPECSHEETS_READY: 'Spec sheets ready',
  SMS_LAUNCHED:     'SMS lanciati',
};

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

/**
 * Dialog for creating or editing a calendar milestone/event.
 *
 * In edit mode the dialog shows two tabs: "Dettagli" (this form) and
 * "Dipendenze" (the `DependencyManager`). In read-only mode it renders a
 * compact information card with no form fields.
 *
 * @param calendarId - Parent season calendar ID (used only in create mode).
 * @param availableFunctions - Company functions available as owner/visibility targets.
 * @param functionsById - Map of function ID → name for display in read-only mode.
 * @param event - Existing event to edit; omit for create mode.
 * @param defaultDate - ISO date pre-filled in the start-date field on create.
 * @param readOnly - When true renders a read-only info card instead of the form.
 * @param onDeleted - Called after the event is successfully deleted.
 * @param allEvents - Full list of events in the calendar, passed to DependencyManager.
 */
export function CalendarEventDialog({
  open, onClose, onSaved, calendarId, availableFunctions, functionsById = {},
  event, defaultDate, defaultAllDay = true, readOnly = false, onDeleted, allEvents = [],
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
  const [severity, setSeverity] = useState<EventSeverity>(event?.severity ?? 'NORMAL');
  const [relevantCountries, setRelevantCountries] = useState<RelevantCountryCode[]>((event?.relevantCountries as RelevantCountryCode[]) ?? []);
  const [collectionProgress, setCollectionProgress] = useState<string | null>(event?.requiredCollectionProgress ?? null);
  const [collectionProgressDays, setCollectionProgressDays] = useState<number | null>(event?.progressWarningDays ?? null);
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
    setSeverity(event?.severity ?? 'NORMAL');
    setRelevantCountries((event?.relevantCountries as RelevantCountryCode[]) ?? []);
    setCollectionProgress(event?.requiredCollectionProgress ?? null);
    setCollectionProgressDays(event?.progressWarningDays ?? null);
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
      severity,
      relevantCountries,
      requiredCollectionProgress: collectionProgress || undefined,
      progressWarningDays: collectionProgress ? (collectionProgressDays ?? undefined) : undefined,
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
              {event.severity === 'CRITICAL' && (
                <Badge variant="destructive" className="gap-1">
                  <AlertTriangle size={10} /> Critico
                </Badge>
              )}
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

  const formFields = (
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

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Criticità</Label>
          <Select value={severity} onValueChange={v => setSeverity(v as EventSeverity)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {EVENT_SEVERITY.map(s => (
                <SelectItem key={s} value={s}>
                  {s === 'CRITICAL' && <AlertTriangle className="mr-1.5 inline h-3 w-3 text-yellow-500" />}
                  {SEVERITY_LABELS[s] ?? s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Paesi rilevanti</Label>
          <div className="flex flex-wrap gap-2 pt-1">
            {RELEVANT_COUNTRY_CODES.map(code => (
              <label key={code} className="flex cursor-pointer items-center gap-1">
                <Checkbox
                  checked={relevantCountries.includes(code)}
                  onCheckedChange={() =>
                    setRelevantCountries(prev =>
                      prev.includes(code) ? prev.filter(c => c !== code) : [...prev, code as RelevantCountryCode]
                    )
                  }
                />
                <span className="text-xs font-mono">{code}</span>
              </label>
            ))}
          </div>
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

      <div className="flex items-center gap-2">
        <Checkbox id="ev-publish" checked={publishExternally} onCheckedChange={v => setPublishExternally(!!v)} />
        <Label htmlFor="ev-publish" className="cursor-pointer font-normal">Pubblica su Google Calendar</Label>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="ev-desc">Descrizione</Label>
        <Textarea id="ev-desc" value={description} onChange={e => setDescription(e.target.value)}
          placeholder="Note opzionali…" className="resize-none text-sm" rows={3} />
      </div>

      <div className="space-y-2 pt-1 border-t">
        <p className="text-xs font-medium text-muted-foreground">Scadenza collezione (opzionale)</p>
        <div className="flex items-center gap-2">
          <Select
            value={collectionProgress ?? '__none__'}
            onValueChange={v => { const val = v === '__none__' ? null : v; setCollectionProgress(val); if (!val) setCollectionProgressDays(null); }}
          >
            <SelectTrigger className="flex-1 text-sm h-8">
              <SelectValue placeholder="Nessun requisito" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">Nessun requisito</SelectItem>
              {COLLECTION_PROGRESS.map(p => (
                <SelectItem key={p} value={p}>{COLLECTION_PROGRESS_LABELS[p] ?? p}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {collectionProgress && (
            <div className="flex items-center gap-1 shrink-0">
              <Input
                type="number"
                min={1}
                max={365}
                value={collectionProgressDays ?? ''}
                onChange={e => setCollectionProgressDays(e.target.value ? Number(e.target.value) : null)}
                className="w-16 h-8 text-sm"
                placeholder="7"
              />
              <span className="text-xs text-muted-foreground">gg prima</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <>
      <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
        <DialogContent className="sm:max-w-[520px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{isEdit ? 'Modifica evento' : 'Nuovo evento'}</DialogTitle>
          </DialogHeader>

          {isEdit ? (
            <Tabs defaultValue="dettagli">
              <TabsList className="w-full">
                <TabsTrigger value="dettagli" className="flex-1">Dettagli</TabsTrigger>
                <TabsTrigger value="dipendenze" className="flex-1">Dipendenze</TabsTrigger>
              </TabsList>
              <TabsContent value="dettagli">{formFields}</TabsContent>
              <TabsContent value="dipendenze">
                <DependencyManager
                  eventId={event.id}
                  calendarId={calendarId}
                  allEvents={allEvents}
                  readOnly={false}
                />
              </TabsContent>
            </Tabs>
          ) : formFields}

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
