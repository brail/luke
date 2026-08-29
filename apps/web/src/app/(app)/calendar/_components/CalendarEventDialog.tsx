'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import { CalendarEventBaseSchema } from '@luke/core';

import { CalendarDaysRelevanceSelect, NO_RELEVANCE_VALUE } from '../../../../components/CalendarDaysRelevanceSelect';
import { ConfirmDialog } from '../../../../components/ConfirmDialog';
import { LastModifiedBy } from '../../../../components/LastModifiedBy';
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
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '../../../../components/ui/form';
import { Input } from '../../../../components/ui/input';
import { Textarea } from '../../../../components/ui/textarea';
import { usePermission } from '../../../../hooks/usePermission';
import {
  UNTOUCHED_SIDES,
  addOneHour,
  applyLinkedEdit,
  resolveIso,
  toDateInput,
  toTimeInput,
  type DateRangeState,
  type RangeSide,
} from '../../../../lib/linkedDateRange';
import { trpc } from '../../../../lib/trpc';
import { getTrpcErrorMessage } from '../../../../lib/trpcErrorMessages';
import { daysBetween, isEventDateLocked, isEventDeleteLocked } from '../utils';

import { CalendarEventShareSection } from './CalendarEventShareSection';
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

// TODO(Fase5): motore alert avrà bisogno dello stesso calcolo di scostamento lato server —
// se estratto in helper condiviso, mantenere identica la semantica di arrotondamento (daysBetween).
/** Days elapsed between the frozen baseline start and the current start, or null if not frozen / unchanged. */
interface EventFormData {
  title: string;
  description: string;
  /** `_none` when no phase is linked — the select needs a non-empty sentinel. */
  phaseId: string;
  /** `NO_RELEVANCE_VALUE` when the deadline is counted in plain calendar days. */
  calendarDaysRelevance: string;
  planningGroupId: string;
  visibilityFunctionIds: string[];
  allDay: boolean;
  publishExternally: boolean;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
}

/**
 * The form's own shape of a calendar event. It is not the mutation input: dates live here as the
 * `yyyy-mm-dd` + `hh:mm` pairs the inputs hold and are resolved to ISO instants on submit, and the
 * two selects use sentinels rather than null. Title, description and the visibility list keep the
 * rules `CalendarEventBaseSchema` states, including its message.
 */
const EventFormBaseSchema = CalendarEventBaseSchema
  .pick({ title: true, description: true, visibilityFunctionIds: true })
  .extend({
    title: z.string().min(1, 'Il titolo è obbligatorio').max(200, 'Massimo 200 caratteri'),
    description: z.string().max(2000, 'Massimo 2000 caratteri'),
    phaseId: z.string(),
    calendarDaysRelevance: z.string(),
    planningGroupId: z.string(),
    allDay: z.boolean(),
    publishExternally: z.boolean(),
    startDate: z.string().min(1, 'La data di inizio è obbligatoria'),
    startTime: z.string(),
    endDate: z.string(),
    endTime: z.string(),
  });

interface RescheduleFormData {
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  allDay: boolean;
  reason: string;
}

/**
 * The motivated-move form. It carries its own copy of the range: cancelling out of the move must
 * not leave the event's dates altered behind it.
 */
const RescheduleFormSchema: z.ZodType<RescheduleFormData, RescheduleFormData> = z.object({
  startDate: z.string().min(1, 'La nuova data di inizio è obbligatoria'),
  startTime: z.string(),
  endDate: z.string(),
  endTime: z.string(),
  allDay: z.boolean(),
  reason: z.string().min(1, 'La motivazione è obbligatoria'),
});

interface CancelFormData {
  reason: string;
}

const CancelFormSchema = z.object({
  reason: z.string().min(1, 'La motivazione è obbligatoria'),
});

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

  // The planning group is only asked for on create; in edit mode the event already belongs to one
  // and no selector is rendered, so requiring it would reject a submit with nowhere to show why.
  const schema = useMemo<z.ZodType<EventFormData, EventFormData>>(
    () =>
      isEdit
        ? EventFormBaseSchema
        : EventFormBaseSchema.extend({
            planningGroupId: z.string().min(1, 'Seleziona un gruppo di pianificazione'),
          }),
    [isEdit]
  );

  const form = useForm<EventFormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      title: '', description: '', phaseId: '_none', calendarDaysRelevance: NO_RELEVANCE_VALUE,
      planningGroupId: '', visibilityFunctionIds: [], allDay: defaultAllDay,
      publishExternally: true, startDate: '', startTime: '', endDate: '', endTime: '',
    },
  });
  const rescheduleForm = useForm<RescheduleFormData>({
    resolver: zodResolver(RescheduleFormSchema),
    defaultValues: { startDate: '', startTime: '', endDate: '', endTime: '', allDay: false, reason: '' },
  });
  const cancelForm = useForm<CancelFormData>({
    resolver: zodResolver(CancelFormSchema),
    defaultValues: { reason: '' },
  });

  // Which range sides the user has edited directly — interaction state, not form data, and one
  // tracker per range since the move dialog edits its own copy.
  const rangeTouched = useRef({ ...UNTOUCHED_SIDES });
  const rescheduleTouched = useRef({ ...UNTOUCHED_SIDES });

  const allDay = form.watch('allDay');
  const visibilityFunctionIds = form.watch('visibilityFunctionIds');
  const planningGroupId = form.watch('planningGroupId');

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [rescheduleOpen, setRescheduleOpen] = useState(false);

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
    const sd = toDateInput(event?.startAt ?? defaultDate);
    const st = event ? toTimeInput(event.startAt) : (defaultAllDay ? '09:00' : toTimeInput(defaultDate));
    rangeTouched.current = { ...UNTOUCHED_SIDES };
    form.reset({
      title: event?.title ?? '',
      description: event?.description ?? '',
      phaseId: event?.phaseId ?? '_none',
      calendarDaysRelevance: event?.calendarDaysRelevance ?? NO_RELEVANCE_VALUE,
      planningGroupId: '',
      visibilityFunctionIds: event ? event.visibilities.map(v => v.functionId) : [],
      allDay: event?.allDay ?? defaultAllDay,
      publishExternally: event?.publishExternally ?? true,
      startDate: sd,
      startTime: st,
      endDate: event?.endAt ? toDateInput(event.endAt) : sd,
      endTime: event?.endAt ? toTimeInput(event.endAt) : addOneHour(st),
    });
    // Deliberately not depending on `form`: it is stable, and listing it would reset the fields
    // under the user on every render.
  }, [event?.id, open, defaultDate]);

  const toggleVisible = (fnId: string) => {
    const next = visibilityFunctionIds.includes(fnId)
      ? visibilityFunctionIds.filter(k => k !== fnId)
      : [...visibilityFunctionIds, fnId];
    form.setValue('visibilityFunctionIds', next, { shouldValidate: true });
  };

  /** Routes one range edit through the linked/clamp rule, then writes all four fields back. */
  const applyRange = (side: RangeSide, patch: Partial<DateRangeState>) => {
    const v = form.getValues();
    const { next, touched } = applyLinkedEdit(
      { startDate: v.startDate, startTime: v.startTime, endDate: v.endDate, endTime: v.endTime },
      side, patch, v.allDay, rangeTouched.current
    );
    rangeTouched.current = touched;
    form.setValue('startDate', next.startDate, { shouldValidate: true });
    form.setValue('startTime', next.startTime);
    form.setValue('endDate', next.endDate);
    form.setValue('endTime', next.endTime);
  };

  const applyRescheduleRange = (side: RangeSide, patch: Partial<DateRangeState>) => {
    const v = rescheduleForm.getValues();
    const { next, touched } = applyLinkedEdit(
      { startDate: v.startDate, startTime: v.startTime, endDate: v.endDate, endTime: v.endTime },
      side, patch, v.allDay, rescheduleTouched.current
    );
    rescheduleTouched.current = touched;
    rescheduleForm.setValue('startDate', next.startDate, { shouldValidate: true });
    rescheduleForm.setValue('startTime', next.startTime);
    rescheduleForm.setValue('endDate', next.endDate);
    rescheduleForm.setValue('endTime', next.endTime);
  };

  // The selector shows the first group until the user picks one; mirror that into form state, so
  // the value that gets validated and submitted is the one displayed as selected.
  useEffect(() => {
    if (!isEdit && !form.getValues('planningGroupId') && planningGroups[0]?.id) {
      form.setValue('planningGroupId', planningGroups[0].id, { shouldValidate: true });
    }
  }, [isEdit, planningGroups, form]);

  /** Seeds the move dialog from the event's current range, so it starts where the event is. */
  const openReschedule = () => {
    const v = form.getValues();
    rescheduleTouched.current = { ...UNTOUCHED_SIDES };
    rescheduleForm.reset({
      startDate: v.startDate, startTime: v.startTime,
      endDate: v.endDate, endTime: v.endTime,
      allDay: v.allDay, reason: '',
    });
    setRescheduleOpen(true);
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
      cancelForm.reset();
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
      rescheduleForm.reset();
      onSaved();
      onClose();
    },
    onError: err => toast.error(getTrpcErrorMessage(err)),
  });

  const handleReschedule = (data: RescheduleFormData) => {
    if (!event) return;
    const startIso = resolveIso(data.startDate, data.startTime, data.allDay);
    const endIso = data.endDate ? resolveIso(data.endDate, data.endTime, data.allDay) : undefined;
    rescheduleMutation.mutate({
      id: event.id, startAt: startIso, endAt: endIso, allDay: data.allDay, reason: data.reason.trim(),
    });
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  const handleSubmit = (data: EventFormData) => {
    const startIso = resolveIso(data.startDate, data.startTime, data.allDay);
    const endIso = data.endDate ? resolveIso(data.endDate, data.endTime, data.allDay) : undefined;

    const payload = {
      title: data.title.trim(),
      description: data.description.trim() || undefined,
      phaseId: data.phaseId === '_none' ? null : data.phaseId,
      calendarDaysRelevance: data.calendarDaysRelevance === NO_RELEVANCE_VALUE ? null : (data.calendarDaysRelevance as 'COMPANY' | 'VENDOR' | 'BOTH'),
      visibilityFunctionIds: data.visibilityFunctionIds,
      startAt: startIso,
      endAt: endIso,
      allDay: data.allDay,
      publishExternally: data.publishExternally,
    };

    if (isEdit) {
      // Locked fields are disabled in the form so their state never actually diverges from `event`,
      // but omit them from the payload outright — updateMilestone treats a missing key as "don't
      // touch", the correct semantics for a field the user isn't allowed to change here. Date changes
      // only ever go through the motivated `rescheduleMilestone` flow (handleReschedule).
      const { title: _title, phaseId: _phaseId, startAt: _startAt, endAt: _endAt, allDay: _allDay, ...unlockedPayload } = payload;
      const updatePayload = isDateLocked ? unlockedPayload : payload;
      updateMutation.mutate({ id: event.id, data: updatePayload });
    } else {
      createMutation.mutate({ planningGroupId: data.planningGroupId, ...payload });
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
        <DialogContent className="sm:max-w-[480px]"> {/* px: dialog width tuned to this form's content; no exact Tailwind max-w scale match */}
          <DialogHeader>
            <DialogTitle className="leading-snug">{event.title}</DialogTitle>
            <LastModifiedBy targetType="CalendarEvent" targetId={event.id} />
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
        <DialogContent className="sm:max-w-[680px] max-h-[90vh] p-0 gap-0 flex flex-col"> {/* px/vh: dialog width tuned to content, vh cap has no Tailwind scale equivalent */}
          <DialogHeader className="px-6 py-4 border-b shrink-0">
            <DialogTitle className="flex items-center gap-2">
              {isEdit ? 'Modifica evento' : 'Nuovo evento'}
              {isEdit && event?.planningGroupName && (
                <Badge variant="outline" className="text-muted-foreground font-normal">Gruppo: {event.planningGroupName}</Badge>
              )}
            </DialogTitle>
            {isEdit && event?.id && (
              <LastModifiedBy targetType="CalendarEvent" targetId={event.id} />
            )}
          </DialogHeader>

          <Form {...form}>
          {/* flex, not the usual grid: this DialogContent overrides its own layout with
              `p-0 gap-0 flex flex-col`, and the form has to stay transparent to it. */}
          <form onSubmit={form.handleSubmit(handleSubmit)} className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4 space-y-4">
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem className="space-y-1.5">
                  <FormLabel>Titolo *</FormLabel>
                  <FormControl>
                    <Input placeholder="Nome dell'evento" disabled={isDateLocked || isPending} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="phaseId"
              render={({ field }) => (
                <FormItem className="space-y-1.5">
                  <FormLabel>Fase</FormLabel>
                  <FormControl>
                    <PhaseSelect value={field.value} onValueChange={field.onChange} phases={availablePhases} disabled={isDateLocked} />
                  </FormControl>
                  <FormDescription className="text-xs">
                    Collega l&apos;evento a una fase di produzione — necessario perché il motore di criticità delle righe collezione lo consideri come scadenza.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="calendarDaysRelevance"
              render={({ field }) => (
                <FormItem className="space-y-1.5">
                  <FormLabel>Conteggio giorni scadenza</FormLabel>
                  <FormControl>
                    <CalendarDaysRelevanceSelect value={field.value} onValueChange={field.onChange} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {!isEdit && (
              <FormField
                control={form.control}
                name="planningGroupId"
                render={({ field }) => (
                  <FormItem className="space-y-1.5">
                    <FormLabel>Gruppo di pianificazione *</FormLabel>
                    <FormControl>
                      <PlanningGroupSelect
                        value={field.value || effectivePlanningGroupId}
                        onValueChange={field.onChange}
                        groups={planningGroups}
                        placeholder="Seleziona gruppo…"
                      />
                    </FormControl>
                    <FormDescription className="text-xs">
                      Determina a quali righe di collezione si applica questo evento.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <FormField
              control={form.control}
              name="visibilityFunctionIds"
              render={() => (
                <FormItem className="space-y-1.5">
                  <FormLabel>Visibile a *</FormLabel>
                  <div className="flex flex-wrap gap-3">
                    {availableFunctions.map(fn => (
                      <label key={fn.id} className="flex items-center gap-1.5 cursor-pointer">
                        <Checkbox checked={visibilityFunctionIds.includes(fn.id)} onCheckedChange={() => toggleVisible(fn.id)} />
                        <span className="text-sm">{fn.name}</span>
                      </label>
                    ))}
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />

            {isEdit && event?.id && (
              <CalendarEventShareSection eventId={event.id} readOnly={readOnly} />
            )}

            <FormField
              control={form.control}
              name="allDay"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center gap-2 space-y-0">
                  <FormControl>
                    <Checkbox checked={field.value} onCheckedChange={v => field.onChange(!!v)} disabled={isDateLocked} />
                  </FormControl>
                  <FormLabel className="cursor-pointer font-normal">Tutto il giorno</FormLabel>
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="startDate"
                render={({ field }) => (
                  <FormItem className="space-y-1.5">
                    <FormLabel>Inizio *</FormLabel>
                    <FormControl>
                      <Input type="date" value={field.value} disabled={isDateLocked}
                        onChange={e => applyRange('start', { startDate: e.target.value })}
                        className="[&::-webkit-datetime-edit-fields-wrapper]:text-muted-foreground" />
                    </FormControl>
                    {!allDay && (
                      <Input type="time" value={form.watch('startTime')} disabled={isDateLocked}
                        onChange={e => applyRange('start', { startTime: e.target.value })}
                        className="[&::-webkit-datetime-edit-fields-wrapper]:text-muted-foreground" />
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="endDate"
                render={({ field }) => (
                  <FormItem className="space-y-1.5">
                    <FormLabel>Fine</FormLabel>
                    <FormControl>
                      <Input type="date" value={field.value} disabled={isDateLocked}
                        onChange={e => applyRange('end', { endDate: e.target.value })}
                        className="[&::-webkit-datetime-edit-fields-wrapper]:text-muted-foreground" />
                    </FormControl>
                    {!allDay && (
                      <Input type="time" value={form.watch('endTime')} disabled={isDateLocked}
                        onChange={e => applyRange('end', { endTime: e.target.value })}
                        className="[&::-webkit-datetime-edit-fields-wrapper]:text-muted-foreground" />
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />
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

            <FormField
              control={form.control}
              name="publishExternally"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center gap-2 space-y-0">
                  <FormControl>
                    <Checkbox checked={field.value} onCheckedChange={v => field.onChange(!!v)} />
                  </FormControl>
                  <FormLabel className="cursor-pointer font-normal">Pubblica su Google Calendar</FormLabel>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem className="space-y-1.5">
                  <FormLabel>Descrizione</FormLabel>
                  <FormControl>
                    <Textarea placeholder="Note opzionali…" className="resize-none text-sm" rows={3} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <DialogFooter className="flex-wrap gap-y-2 px-6 py-4 border-t shrink-0">
            {isEdit && (
              <div className="mr-auto flex gap-2">
                {isDateLocked && !event.cancelledAt && (
                  <Button type="button" variant="outline" onClick={openReschedule} disabled={isPending}>
                    Sposta con motivazione
                  </Button>
                )}
                {!event.cancelledAt && (
                  // Amber classes match the baseline-drift badge convention already used in this file.
                  <Button type="button" variant="outline" onClick={() => { cancelForm.reset(); setCancelOpen(true); }} disabled={isPending}
                    className="text-amber-700 border-amber-300 hover:bg-amber-50 hover:text-amber-800">
                    Annulla evento
                  </Button>
                )}
                {onDeleted && (
                  <PermissionButton
                    hasPermission={!isDeleteLocked}
                    tooltip="Evento di fase congelato: non può essere eliminato, solo annullato («Annulla evento»)"
                    type="button" variant="destructive" onClick={() => setDeleteOpen(true)} disabled={isPending}>
                    Elimina
                  </PermissionButton>
                )}
              </div>
            )}
            <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>Chiudi</Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? 'Salvataggio…' : isEdit ? 'Salva' : 'Crea'}
            </Button>
          </DialogFooter>
          </form>
          </Form>
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
          actionType="delete"
          onConfirm={() => deleteMutation.mutate({ id: event.id })}
          isLoading={deleteMutation.isPending}
        />
      )}

      {isEdit && (
        <Dialog
          open={cancelOpen}
          onOpenChange={v => { if (!v && !cancelMutation.isPending) setCancelOpen(false); }}
        >
          <DialogContent className="sm:max-w-[440px]"> {/* px: dialog width tuned to this form's content; no exact Tailwind max-w scale match */}
            <DialogHeader>
              <DialogTitle>Annulla evento</DialogTitle>
            </DialogHeader>
            <Form {...cancelForm}>
              <form
                onSubmit={cancelForm.handleSubmit(data =>
                  cancelMutation.mutate({ id: event.id, reason: data.reason.trim() })
                )}
                className="grid gap-4"
              >
                <div className="space-y-3 py-2">
                  <p className="text-sm text-muted-foreground">
                    L&apos;evento resta nello storico ma viene escluso dal motore di criticità. La motivazione è obbligatoria.
                  </p>
                  <FormField
                    control={cancelForm.control}
                    name="reason"
                    render={({ field }) => (
                      <FormItem className="space-y-1.5">
                        <FormLabel>Motivazione *</FormLabel>
                        <FormControl>
                          <Textarea
                            placeholder="Perché questo evento viene annullato…"
                            className="resize-none text-sm"
                            rows={3}
                            disabled={cancelMutation.isPending}
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setCancelOpen(false)} disabled={cancelMutation.isPending}>
                    Indietro
                  </Button>
                  <Button type="submit" variant="destructive" disabled={cancelMutation.isPending}>
                    {cancelMutation.isPending ? 'Annullamento…' : 'Conferma annullamento'}
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      )}

      {isEdit && (
        <Dialog
          open={rescheduleOpen}
          onOpenChange={v => { if (!v && !rescheduleMutation.isPending) setRescheduleOpen(false); }}
        >
          <DialogContent className="sm:max-w-[440px]"> {/* px: dialog width tuned to this form's content; no exact Tailwind max-w scale match */}
            <DialogHeader>
              <DialogTitle>Sposta evento (motivato)</DialogTitle>
            </DialogHeader>
            <Form {...rescheduleForm}>
              <form onSubmit={rescheduleForm.handleSubmit(handleReschedule)} className="grid gap-4">
                <div className="space-y-3 py-2">
                  <p className="text-sm text-muted-foreground">
                    La baseline congelata resta invariata — la varianza continua a misurare il piano originale;
                    si aggiorna solo la scadenza operativa. La motivazione è obbligatoria.
                  </p>
                  <FormField
                    control={rescheduleForm.control}
                    name="allDay"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-center gap-2 space-y-0">
                        <FormControl>
                          <Checkbox checked={field.value} onCheckedChange={v => field.onChange(!!v)} />
                        </FormControl>
                        <FormLabel className="cursor-pointer font-normal">Tutto il giorno</FormLabel>
                      </FormItem>
                    )}
                  />
                  <div className="grid grid-cols-2 gap-3">
                    <FormField
                      control={rescheduleForm.control}
                      name="startDate"
                      render={({ field }) => (
                        <FormItem className="space-y-1.5">
                          <FormLabel>Nuovo inizio *</FormLabel>
                          <FormControl>
                            <Input type="date" value={field.value}
                              onChange={e => applyRescheduleRange('start', { startDate: e.target.value })} />
                          </FormControl>
                          {!rescheduleForm.watch('allDay') && (
                            <Input type="time" value={rescheduleForm.watch('startTime')}
                              onChange={e => applyRescheduleRange('start', { startTime: e.target.value })} />
                          )}
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={rescheduleForm.control}
                      name="endDate"
                      render={({ field }) => (
                        <FormItem className="space-y-1.5">
                          <FormLabel>Nuova fine</FormLabel>
                          <FormControl>
                            <Input type="date" value={field.value}
                              onChange={e => applyRescheduleRange('end', { endDate: e.target.value })} />
                          </FormControl>
                          {!rescheduleForm.watch('allDay') && (
                            <Input type="time" value={rescheduleForm.watch('endTime')}
                              onChange={e => applyRescheduleRange('end', { endTime: e.target.value })} />
                          )}
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <FormField
                    control={rescheduleForm.control}
                    name="reason"
                    render={({ field }) => (
                      <FormItem className="space-y-1.5">
                        <FormLabel>Motivazione *</FormLabel>
                        <FormControl>
                          <Textarea
                            placeholder="Perché la scadenza viene spostata…"
                            className="resize-none text-sm"
                            rows={3}
                            disabled={rescheduleMutation.isPending}
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setRescheduleOpen(false)} disabled={rescheduleMutation.isPending}>
                    Indietro
                  </Button>
                  <Button type="submit" disabled={rescheduleMutation.isPending}>
                    {rescheduleMutation.isPending ? 'Spostamento…' : 'Conferma spostamento'}
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
