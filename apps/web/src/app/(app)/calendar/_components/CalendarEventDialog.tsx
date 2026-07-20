'use client';

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { CalendarDaysRelevanceSelect, NO_RELEVANCE_VALUE } from '../../../../components/CalendarDaysRelevanceSelect';
import { ConfirmDialog } from '../../../../components/ConfirmDialog';
import { PermissionButton } from '../../../../components/PermissionButton';
import { PhaseSelect } from '../../../../components/PhaseSelect';
import { PlanningGroupSelect } from '../../../../components/PlanningGroupSelect';
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
import { Textarea } from '../../../../components/ui/textarea';
import { usePermission } from '../../../../hooks/usePermission';
import { trpc } from '../../../../lib/trpc';
import { getTrpcErrorMessage } from '../../../../lib/trpcErrorMessages';
import { daysBetween, isEventDateLocked, isEventDeleteLocked } from '../utils';

import { type CalendarEventItem } from './types';

interface ExistingEvent {
  id: string;
  title: string;
  description?: string | null;
  startAt: Date | string;
  endAt?: Date | string | null;
  baselineStartAt?: Date | string | null;
  baselineEndAt?: Date | string | null;
  allDay: boolean;
  cancelledAt?: Date | string | null;
  cancelReason?: string | null;
  phaseId?: string | null;
  calendarDaysRelevance?: string | null;
  publishExternally: boolean;
  visibilities: { functionId: string }[];
  planningGroupName?: string;
  planningGroupFrozenAt?: Date | string | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  brandId: string;
  seasonId: string;
  availableFunctions: { id: string; name: string }[];
  functionsById?: Record<string, string>;
  event?: ExistingEvent;
  existingMilestones?: CalendarEventItem[];
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

/** Bare date parses as UTC midnight per spec — unlike `buildIso`, needed for all-day events so the
 * calendar day survives round-tripping through non-UTC-midnight-aware consumers (e.g. Google Calendar). */
function buildAllDayIso(date: string): string {
  return new Date(date).toISOString();
}

/** Resolves a date/time pair to an ISO instant, using UTC-midnight semantics for all-day events. */
function resolveIso(date: string, time: string, allDay: boolean): string {
  return allDay ? buildAllDayIso(date) : buildIso(date, time);
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
 * @param brandId - Brand of the calendar (used to resolve planning groups in create mode).
 * @param seasonId - Season of the calendar (used to resolve planning groups in create mode).
 * @param availableFunctions - Company functions available as visibility targets.
 * @param functionsById - Map of function ID → name for display in read-only mode.
 * @param event - Existing event to edit; omit for create mode.
 * @param defaultDate - ISO date pre-filled in the start-date field on create.
 * @param readOnly - When true renders a read-only info card instead of the form.
 * @param onDeleted - Called after the event is successfully deleted.
 */
export function CalendarEventDialog({
  open, onClose, onSaved, brandId, seasonId, availableFunctions, functionsById = {},
  event, existingMilestones = [], defaultDate, defaultAllDay = true, readOnly = false, onDeleted,
}: Props) {
  const isEdit = !!event;
  const isCancelled = !!event?.cancelledAt;
  const { can } = usePermission();

  // A phase event whose planning group is frozen and whose deadline has passed is locked: the backend
  // rejects title/phase/date edits (they'd rewrite what the frozen baseline committed to). Date moves
  // only via the motivated reschedule flow; title/phase have no such escape hatch — only unfreezing
  // the group lifts the lock. Shared helper mirrors isEventDateLocked on the server.
  const isDateLocked = !!event && isEventDateLocked(event);

  // A phase event whose planning group is frozen can't be hard-deleted — that would destroy the
  // frozen baseline. The backend rejects it (isEventDeleteLocked); mirror it so the button doesn't
  // look clickable then fail with a toast. "Annulla evento" is the correct action instead.
  const isDeleteLocked = !!event && isEventDeleteLocked(event);

  const { data: phases = [] } = trpc.phase.list.useQuery(undefined, { staleTime: 5 * 60 * 1000 });
  const { data: planningGroups = [] } = trpc.planningGroup.list.useQuery(
    { brandId, seasonId },
    { enabled: open && !isEdit }
  );

  const [title, setTitle] = useState(event?.title ?? '');
  const [description, setDescription] = useState(event?.description ?? '');
  const [phaseId, setPhaseId] = useState<string>(event?.phaseId ?? '_none');
  const [calendarDaysRelevance, setCalendarDaysRelevance] = useState<string>(event?.calendarDaysRelevance ?? NO_RELEVANCE_VALUE);
  const [visibilityFunctionIds, setVisibilityFunctionIds] = useState<string[]>(() =>
    event ? event.visibilities.map(v => v.functionId) : []
  );
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
  const [planningGroupId, setPlanningGroupId] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [rescheduleReason, setRescheduleReason] = useState('');

  // Defaults to the first group until the user picks one — fully derivable from `planningGroups`,
  // no need to sync it into state via an effect once the query resolves.
  const effectivePlanningGroupId = planningGroupId || planningGroups[0]?.id || '';

  // Phases already claimed by another active event in this group — the backend enforces this with a
  // partial unique index (planningGroupId, phaseId) WHERE cancelledAt IS NULL, so offering them here
  // would just fail on submit.
  const availablePhases = useMemo(() => {
    // In edit mode the group can't be changed (no selector rendered), so read it off the event's own
    // record in the already-fetched milestones list rather than adding a planningGroupId prop.
    const filterGroupId = isEdit
      ? existingMilestones.find(m => m.id === event.id)?.planningGroupId
      : effectivePlanningGroupId;
    const usedPhaseIds = new Set(
      existingMilestones
        .filter(m => m.planningGroupId === filterGroupId && !m.cancelledAt && m.phaseId && m.id !== event?.id)
        .map(m => m.phaseId)
    );
    return phases.filter(p => !usedPhaseIds.has(p.id));
  }, [isEdit, existingMilestones, event, effectivePlanningGroupId, phases]);

  useEffect(() => {
    setTitle(event?.title ?? '');
    setDescription(event?.description ?? '');
    setPhaseId(event?.phaseId ?? '_none');
    setCalendarDaysRelevance(event?.calendarDaysRelevance ?? NO_RELEVANCE_VALUE);
    setVisibilityFunctionIds(event ? event.visibilities.map(v => v.functionId) : []);
    const sd = toDateInput(event?.startAt ?? defaultDate);
    const st = event ? toTimeInput(event.startAt) : (defaultAllDay ? '09:00' : toTimeInput(defaultDate));
    setStartDate(sd);
    setStartTime(st);
    setEndDate(event?.endAt ? toDateInput(event.endAt) : sd);
    setEndTime(event?.endAt ? toTimeInput(event.endAt) : addOneHour(st));
    setAllDay(event?.allDay ?? defaultAllDay);
    setPublishExternally(event?.publishExternally ?? true);
  }, [event?.id, open, defaultDate]);

  const toggleVisible = (fnId: string) => {
    setVisibilityFunctionIds(prev =>
      prev.includes(fnId) ? prev.filter(k => k !== fnId) : [...prev, fnId]
    );
  };

  const createMutation = trpc.seasonCalendar.createMilestone.useMutation({
    onSuccess: data => { if (data.phaseOrderWarning) toast.warning(data.phaseOrderWarning); toast.success('Evento creato'); onSaved(); onClose(); },
    onError: err => toast.error(getTrpcErrorMessage(err)),
  });

  const updateMutation = trpc.seasonCalendar.updateMilestone.useMutation({
    onSuccess: data => { if (data.phaseOrderWarning) toast.warning(data.phaseOrderWarning); toast.success('Evento aggiornato'); onSaved(); onClose(); },
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

  const cancelMutation = trpc.seasonCalendar.cancelMilestone.useMutation({
    onSuccess: () => {
      toast.success('Evento annullato');
      setCancelOpen(false);
      setCancelReason('');
      onSaved();
      onClose();
    },
    onError: err => toast.error(getTrpcErrorMessage(err)),
  });

  const uncancelMutation = trpc.seasonCalendar.uncancelMilestone.useMutation({
    onSuccess: () => {
      toast.success('Evento ripristinato');
      onSaved();
      onClose();
    },
    onError: err => toast.error(getTrpcErrorMessage(err)),
  });

  const rescheduleMutation = trpc.seasonCalendar.rescheduleMilestone.useMutation({
    onSuccess: data => {
      if (data.phaseOrderWarning) toast.warning(data.phaseOrderWarning);
      toast.success('Evento spostato');
      setRescheduleOpen(false);
      setRescheduleReason('');
      onSaved();
      onClose();
    },
    onError: err => toast.error(getTrpcErrorMessage(err)),
  });

  const handleReschedule = () => {
    if (!event || !startDate || !rescheduleReason.trim()) return;
    const startIso = resolveIso(startDate, startTime, allDay);
    const endIso = endDate ? resolveIso(endDate, endTime, allDay) : undefined;
    rescheduleMutation.mutate({ id: event.id, startAt: startIso, endAt: endIso, allDay, reason: rescheduleReason.trim() });
  };

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
    if (!isEdit && !effectivePlanningGroupId) {
      toast.error('Seleziona un gruppo di pianificazione');
      return;
    }
    const startIso = resolveIso(startDate, startTime, allDay);
    const endIso = endDate ? resolveIso(endDate, endTime, allDay) : undefined;

    const payload = {
      title: title.trim(),
      description: description.trim() || undefined,
      phaseId: phaseId === '_none' ? null : phaseId,
      calendarDaysRelevance: calendarDaysRelevance === NO_RELEVANCE_VALUE ? null : (calendarDaysRelevance as 'COMPANY' | 'VENDOR' | 'BOTH'),
      visibilityFunctionIds,
      startAt: startIso,
      endAt: endIso,
      allDay,
      publishExternally,
    };

    if (isEdit) {
      // Locked fields are disabled in the form so their state never actually diverges from `event`,
      // but omit them from the payload outright — updateMilestone treats a missing key as "don't
      // touch", the correct semantics for a field the user isn't allowed to change here. Date changes
      // only ever go through the motivated `rescheduleMilestone` flow (handleReschedule).
      const { title: _title, phaseId: _phaseId, startAt: _startAt, endAt: _endAt, allDay: _allDay, ...unlockedPayload } = payload;
      const data = isDateLocked ? unlockedPayload : payload;
      updateMutation.mutate({ id: event.id, data });
    } else {
      createMutation.mutate({ planningGroupId: effectivePlanningGroupId, ...payload });
    }
  };

  if ((readOnly || isCancelled) && event) {
    const dateStr = new Date(event.startAt).toLocaleDateString('it-IT', {
      weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
    });
    const timeStr = !event.allDay
      ? new Date(event.startAt).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
      : null;
    const phaseLabel = phases.find(p => p.id === event.phaseId)?.label;
    const relevanceLabel = event.calendarDaysRelevance
      ? { COMPANY: 'gg lavorativi (azienda)', VENDOR: 'gg lavorativi (fornitore)', BOTH: 'gg lavorativi (entrambi)' }[event.calendarDaysRelevance]
      : null;
    const baselineDrift = describeBaselineDrift(event);
    return (
      <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle className="leading-snug">{event.title}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="flex flex-wrap gap-1.5">
              {phaseLabel && <Badge variant="outline">{phaseLabel}</Badge>}
              {relevanceLabel && <Badge variant="outline" className="text-muted-foreground">{relevanceLabel}</Badge>}
              {event.cancelledAt && <Badge variant="destructive">Annullato</Badge>}
              {event.planningGroupName && (
                <Badge variant="outline" className="text-muted-foreground">Gruppo: {event.planningGroupName}</Badge>
              )}
            </div>
            {event.cancelledAt && event.cancelReason && (
              <div>
                <p className="text-sm font-medium text-muted-foreground mb-1">Motivo annullamento</p>
                <p className="text-sm whitespace-pre-wrap">{event.cancelReason}</p>
              </div>
            )}
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
            {event.cancelledAt && (
              <PermissionButton
                hasPermission={can('season_calendar:uncancel')}
                tooltip="Solo un admin può ripristinare un evento annullato"
                variant="outline" className="mr-auto"
                onClick={() => uncancelMutation.mutate({ id: event.id })}
                disabled={uncancelMutation.isPending}
              >
                {uncancelMutation.isPending ? 'Ripristino…' : 'Ripristina'}
              </PermissionButton>
            )}
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
        <DialogContent className="sm:max-w-[680px] max-h-[90vh] p-0 gap-0 flex flex-col">
          <DialogHeader className="px-6 py-4 border-b shrink-0">
            <DialogTitle className="flex items-center gap-2">
              {isEdit ? 'Modifica evento' : 'Nuovo evento'}
              {isEdit && event?.planningGroupName && (
                <Badge variant="outline" className="text-muted-foreground font-normal">Gruppo: {event.planningGroupName}</Badge>
              )}
            </DialogTitle>
          </DialogHeader>

          <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="ev-title">Titolo *</Label>
              <Input id="ev-title" value={title} onChange={e => setTitle(e.target.value)} placeholder="Nome dell'evento" disabled={isDateLocked} />
            </div>

            <div className="space-y-1.5">
              <Label>Fase</Label>
              <PhaseSelect value={phaseId} onValueChange={setPhaseId} phases={availablePhases} disabled={isDateLocked} />
              <p className="text-xs text-muted-foreground">
                Collega l'evento a una fase di produzione — necessario perché il motore di criticità delle righe collezione lo consideri come scadenza.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label>Conteggio giorni scadenza</Label>
              <CalendarDaysRelevanceSelect value={calendarDaysRelevance} onValueChange={setCalendarDaysRelevance} />
            </div>

            {!isEdit && (
              <div className="space-y-1.5">
                <Label>Gruppo di pianificazione *</Label>
                <PlanningGroupSelect
                  value={effectivePlanningGroupId}
                  onValueChange={setPlanningGroupId}
                  groups={planningGroups}
                  placeholder="Seleziona gruppo…"
                />
                <p className="text-xs text-muted-foreground">
                  Determina a quali righe di collezione si applica questo evento.
                </p>
              </div>
            )}

            <div className="space-y-1.5">
              <Label>Visibile a *</Label>
              <div className="flex flex-wrap gap-3">
                {availableFunctions.map(fn => (
                  <label key={fn.id} className="flex items-center gap-1.5 cursor-pointer">
                    <Checkbox checked={visibilityFunctionIds.includes(fn.id)} onCheckedChange={() => toggleVisible(fn.id)} />
                    <span className="text-sm">{fn.name}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Checkbox id="ev-allday" checked={allDay} onCheckedChange={v => setAllDay(!!v)} disabled={isDateLocked} />
              <Label htmlFor="ev-allday" className="cursor-pointer font-normal">Tutto il giorno</Label>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="ev-start-date">Inizio *</Label>
                <Input id="ev-start-date" type="date" value={startDate} disabled={isDateLocked}
                  onChange={e => { setStartDate(e.target.value); if (!endDate) setEndDate(e.target.value); }}
                  className="[&::-webkit-datetime-edit-fields-wrapper]:text-muted-foreground" />
                {!allDay && (
                  <Input type="time" value={startTime} disabled={isDateLocked}
                    onChange={e => { setStartTime(e.target.value); setEndTime(addOneHour(e.target.value)); }}
                    className="[&::-webkit-datetime-edit-fields-wrapper]:text-muted-foreground" />
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ev-end-date">Fine</Label>
                <Input id="ev-end-date" type="date" value={endDate} disabled={isDateLocked} onChange={e => setEndDate(e.target.value)}
                  className="[&::-webkit-datetime-edit-fields-wrapper]:text-muted-foreground" />
                {!allDay && (
                  <Input type="time" value={endTime} disabled={isDateLocked} onChange={e => setEndTime(e.target.value)}
                    className="[&::-webkit-datetime-edit-fields-wrapper]:text-muted-foreground" />
                )}
              </div>
            </div>

            {isDateLocked && (
              <p className="text-xs text-amber-700">
                Evento di fase congelato e già passato: titolo e fase sono di sola lettura; la data si può cambiare solo con uno spostamento motivato («Sposta con motivazione»).
              </p>
            )}

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

          <DialogFooter className="flex-wrap gap-y-2 px-6 py-4 border-t shrink-0">
            {isEdit && (
              <div className="mr-auto flex gap-2">
                {isDateLocked && !event.cancelledAt && (
                  <Button variant="outline" onClick={() => setRescheduleOpen(true)} disabled={isPending}>
                    Sposta con motivazione
                  </Button>
                )}
                {!event.cancelledAt && (
                  // Amber classes match the baseline-drift badge convention already used in this file.
                  <Button variant="outline" onClick={() => setCancelOpen(true)} disabled={isPending}
                    className="text-amber-700 border-amber-300 hover:bg-amber-50 hover:text-amber-800">
                    Annulla evento
                  </Button>
                )}
                {onDeleted && (
                  <PermissionButton
                    hasPermission={!isDeleteLocked}
                    tooltip="Evento di fase congelato: non può essere eliminato, solo annullato («Annulla evento»)"
                    variant="destructive" onClick={() => setDeleteOpen(true)} disabled={isPending}>
                    Elimina
                  </PermissionButton>
                )}
              </div>
            )}
            <Button variant="outline" onClick={onClose} disabled={isPending}>Chiudi</Button>
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

      {isEdit && (
        <Dialog open={cancelOpen} onOpenChange={v => { if (!v) { setCancelOpen(false); setCancelReason(''); } }}>
          <DialogContent className="sm:max-w-[440px]">
            <DialogHeader>
              <DialogTitle>Annulla evento</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <p className="text-sm text-muted-foreground">
                L&apos;evento resta nello storico ma viene escluso dal motore di criticità. La motivazione è obbligatoria.
              </p>
              <div className="space-y-1.5">
                <Label htmlFor="ev-cancel-reason">Motivazione *</Label>
                <Textarea id="ev-cancel-reason" value={cancelReason} onChange={e => setCancelReason(e.target.value)}
                  placeholder="Perché questo evento viene annullato…" className="resize-none text-sm" rows={3} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setCancelOpen(false); setCancelReason(''); }} disabled={cancelMutation.isPending}>
                Indietro
              </Button>
              <Button variant="destructive"
                onClick={() => cancelMutation.mutate({ id: event.id, reason: cancelReason.trim() })}
                disabled={cancelMutation.isPending || !cancelReason.trim()}>
                {cancelMutation.isPending ? 'Annullamento…' : 'Conferma annullamento'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {isEdit && (
        <Dialog open={rescheduleOpen} onOpenChange={v => { if (!v) { setRescheduleOpen(false); setRescheduleReason(''); } }}>
          <DialogContent className="sm:max-w-[440px]">
            <DialogHeader>
              <DialogTitle>Sposta evento (motivato)</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <p className="text-sm text-muted-foreground">
                La baseline congelata resta invariata — la varianza continua a misurare il piano originale;
                si aggiorna solo la scadenza operativa. La motivazione è obbligatoria.
              </p>
              <div className="flex items-center gap-2">
                <Checkbox id="ev-resched-allday" checked={allDay} onCheckedChange={v => setAllDay(!!v)} />
                <Label htmlFor="ev-resched-allday" className="cursor-pointer font-normal">Tutto il giorno</Label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="ev-resched-start">Nuovo inizio *</Label>
                  <Input id="ev-resched-start" type="date" value={startDate}
                    onChange={e => { setStartDate(e.target.value); if (!endDate) setEndDate(e.target.value); }} />
                  {!allDay && (
                    <Input type="time" value={startTime}
                      onChange={e => { setStartTime(e.target.value); setEndTime(addOneHour(e.target.value)); }} />
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ev-resched-end">Nuova fine</Label>
                  <Input id="ev-resched-end" type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
                  {!allDay && (
                    <Input type="time" value={endTime} onChange={e => setEndTime(e.target.value)} />
                  )}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ev-resched-reason">Motivazione *</Label>
                <Textarea id="ev-resched-reason" value={rescheduleReason} onChange={e => setRescheduleReason(e.target.value)}
                  placeholder="Perché la scadenza viene spostata…" className="resize-none text-sm" rows={3} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setRescheduleOpen(false); setRescheduleReason(''); }} disabled={rescheduleMutation.isPending}>
                Indietro
              </Button>
              <Button onClick={handleReschedule}
                disabled={rescheduleMutation.isPending || !rescheduleReason.trim() || !startDate}>
                {rescheduleMutation.isPending ? 'Spostamento…' : 'Conferma spostamento'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
