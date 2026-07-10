'use client';

import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';

import type { RouterOutputs } from '@luke/api';

import { CalendarDaysRelevanceSelect, NO_RELEVANCE_VALUE } from '../../../../../components/CalendarDaysRelevanceSelect';
import { PhaseSelect } from '../../../../../components/PhaseSelect';
import { Button } from '../../../../../components/ui/button';
import { Checkbox } from '../../../../../components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../../../components/ui/dialog';
import { Input } from '../../../../../components/ui/input';
import { Label } from '../../../../../components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../../../components/ui/select';
import { Textarea } from '../../../../../components/ui/textarea';
import { trpc } from '../../../../../lib/trpc';
import { getTrpcErrorMessage } from '../../../../../lib/trpcErrorMessages';

type TemplateItem = RouterOutputs['seasonCalendar']['listTemplates'][number]['items'][number];

interface SiblingItem {
  id: string;
  title: string;
  offsetDays: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  templateId: string;
  item?: TemplateItem | null;
  availableFunctions: { id: string; name: string }[];
  siblingItems?: SiblingItem[];
}

interface FormValues {
  title: string;
  type: string;
  phaseId: string;
  calendarDaysRelevance: string;
  ownerFunctionId: string;
  visibilityFunctionIds: string[];
  offsetDays: number;
  durationDays: number;
  allDay: boolean;
  publishExternally: boolean;
  description: string;
}

/**
 * Dialog for adding or editing a milestone item within a calendar template.
 *
 * Includes an optional offset-calculator helper that computes the offsetDays
 * relative to another sibling item without creating a formal dependency.
 * The owner function is always included in the visibility list.
 *
 * @param templateId - Parent template ID (used only in create mode).
 * @param item - Existing item to edit; omit for create mode.
 * @param availableFunctions - Company functions available as owner/visibility targets.
 * @param siblingItems - Other items in the same template, used by the offset calculator.
 */
export function TemplateItemDialog({ open, onClose, onSaved, templateId, item, availableFunctions, siblingItems = [] }: Props) {
  const isEdit = !!item;
  const defaultOwner = availableFunctions[0]?.id ?? '';
  const { register, handleSubmit, reset, watch, setValue, control, formState: { errors } } = useForm<FormValues>();

  const [relItemId, setRelItemId] = useState('');
  const [relDelta, setRelDelta] = useState('0');

  const { data: catalogItems = [] } = trpc.calendarCatalog.list.useQuery(
    { type: 'eventType' },
    { staleTime: 5 * 60 * 1000 }
  );
  const { data: phases = [] } = trpc.phase.list.useQuery(undefined, { staleTime: 5 * 60 * 1000 });

  const ownerFunctionId = watch('ownerFunctionId');
  const visibilityFunctionIds = watch('visibilityFunctionIds') ?? [];

  useEffect(() => {
    if (open) {
      setRelItemId('');
      setRelDelta('0');
      const owner = item?.ownerFunctionId ?? defaultOwner;
      reset({
        title: item?.title ?? '',
        type: item?.type ?? 'MILESTONE',
        phaseId: item?.phaseId ?? '_none',
        calendarDaysRelevance: item?.calendarDaysRelevance ?? NO_RELEVANCE_VALUE,
        ownerFunctionId: owner,
        visibilityFunctionIds: item
          ? (item.visibilities?.map((v: NonNullable<TemplateItem['visibilities']>[number]) => v.functionId) ?? [owner])
          : [owner],
        offsetDays: item?.offsetDays ?? 0,
        durationDays: item?.durationDays ?? 0,
        allDay: item?.allDay ?? true,
        publishExternally: item?.publishExternally ?? true,
        description: item?.description ?? '',
      });
    }
  }, [open, item?.id]);

  // Keep owner always in visibility list
  useEffect(() => {
    if (ownerFunctionId && !visibilityFunctionIds.includes(ownerFunctionId)) {
      setValue('visibilityFunctionIds', [...visibilityFunctionIds, ownerFunctionId]);
    }
  }, [ownerFunctionId]); // intentional: only sync when owner changes

  const createMutation = trpc.seasonCalendar.createTemplateItem.useMutation({
    onSuccess: () => { toast.success('Item aggiunto'); onSaved(); },
    onError: err => toast.error(getTrpcErrorMessage(err)),
  });

  const updateMutation = trpc.seasonCalendar.updateTemplateItem.useMutation({
    onSuccess: () => { toast.success('Item aggiornato'); onSaved(); },
    onError: err => toast.error(getTrpcErrorMessage(err)),
  });

  const isPending = createMutation.isPending || updateMutation.isPending;

  const onSubmit = (values: FormValues) => {
    const payload = {
      title: values.title.trim(),
      type: values.type,
      phaseId: values.phaseId === '_none' ? null : values.phaseId,
      calendarDaysRelevance: values.calendarDaysRelevance === NO_RELEVANCE_VALUE ? null : (values.calendarDaysRelevance as 'COMPANY' | 'VENDOR' | 'BOTH'),
      ownerFunctionId: values.ownerFunctionId,
      visibilityFunctionIds: values.visibilityFunctionIds,
      offsetDays: Number(values.offsetDays),
      durationDays: Number(values.durationDays),
      allDay: values.allDay,
      publishExternally: values.publishExternally,
      description: values.description.trim() || undefined,
    };
    if (isEdit) {
      updateMutation.mutate({ id: item.id, ...payload });
    } else {
      createMutation.mutate({ templateId, ...payload });
    }
  };

  const toggleVisible = (fnId: string) => {
    if (fnId === ownerFunctionId) return;
    const current = visibilityFunctionIds;
    setValue(
      'visibilityFunctionIds',
      current.includes(fnId) ? current.filter(s => s !== fnId) : [...current, fnId]
    );
  };

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Modifica item' : 'Nuovo item'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="title">Titolo *</Label>
            <Input
              id="title"
              {...register('title', { required: 'Titolo obbligatorio' })}
              placeholder="es. Kickoff collezione"
            />
            {errors.title && <p className="text-xs text-destructive">{errors.title.message}</p>}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Tipo *</Label>
              <Controller
                name="type"
                control={control}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {catalogItems.map(item => (
                        <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>

            <div className="space-y-1">
              <Label>Funzione owner *</Label>
              <Controller
                name="ownerFunctionId"
                control={control}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger><SelectValue placeholder="Seleziona…" /></SelectTrigger>
                    <SelectContent>
                      {availableFunctions.map(fn => (
                        <SelectItem key={fn.id} value={fn.id}>{fn.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label>Fase</Label>
            <Controller
              name="phaseId"
              control={control}
              render={({ field }) => (
                <PhaseSelect value={field.value} onValueChange={field.onChange} phases={phases} />
              )}
            />
            <p className="text-xs text-muted-foreground">
              Propagata all'evento generato quando il template viene applicato al calendario.
            </p>
          </div>

          <div className="space-y-1">
            <Label>Conteggio giorni scadenza</Label>
            <Controller
              name="calendarDaysRelevance"
              control={control}
              render={({ field }) => (
                <CalendarDaysRelevanceSelect value={field.value} onValueChange={field.onChange} />
              )}
            />
            <p className="text-xs text-muted-foreground">
              Propagato all'evento generato quando il template viene applicato al calendario.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="offsetDays">Offset giorni *</Label>
              <Input
                id="offsetDays"
                type="number"
                {...register('offsetDays', { required: true, valueAsNumber: true })}
              />
              <p className="text-xs text-muted-foreground">Giorni dall'anchor date (negativo = prima)</p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="durationDays">Durata giorni</Label>
              <Input
                id="durationDays"
                type="number"
                min={0}
                {...register('durationDays', { valueAsNumber: true })}
              />
            </div>
          </div>

          {siblingItems.length > 0 && (() => {
            const relItem = siblingItems.find(i => i.id === relItemId);
            const delta = parseInt(relDelta, 10);
            const computed = relItem && !isNaN(delta) ? relItem.offsetDays + delta : null;
            return (
              <div className="rounded-md border px-3 py-2 space-y-2 bg-muted/20">
                <p className="text-xs font-medium text-muted-foreground">Calcola offset da altro item <span className="font-normal">(solo aiuto al calcolo, non crea una dipendenza)</span></p>
                <div className="flex items-center gap-2">
                  <Select value={relItemId} onValueChange={setRelItemId}>
                    <SelectTrigger className="h-8 text-xs flex-1"><SelectValue placeholder="Scegli item…" /></SelectTrigger>
                    <SelectContent>
                      {siblingItems.map(s => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.title} ({s.offsetDays >= 0 ? '+' : ''}{s.offsetDays}gg)
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    type="number"
                    value={relDelta}
                    onChange={e => setRelDelta(e.target.value)}
                    className="h-8 text-xs w-20"
                    placeholder="±gg"
                    disabled={!relItemId}
                  />
                  {computed !== null && (
                    <>
                      <span className="text-xs text-muted-foreground shrink-0">= {computed >= 0 ? '+' : ''}{computed}gg</span>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 text-xs shrink-0"
                        onClick={() => setValue('offsetDays', computed)}
                      >
                        Usa
                      </Button>
                    </>
                  )}
                </div>
              </div>
            );
          })()}

          <div className="space-y-2">
            <Label>Visibile a</Label>
            <div className="flex flex-wrap gap-3">
              {availableFunctions.map(fn => (
                <label key={fn.id} className="flex items-center gap-1.5 cursor-pointer">
                  <Checkbox
                    checked={visibilityFunctionIds.includes(fn.id)}
                    onCheckedChange={() => toggleVisible(fn.id)}
                    disabled={fn.id === ownerFunctionId}
                  />
                  <span className="text-sm">{fn.name}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Controller
              name="allDay"
              control={control}
              render={({ field }) => (
                <Checkbox
                  id="allDay"
                  checked={field.value}
                  onCheckedChange={field.onChange}
                />
              )}
            />
            <Label htmlFor="allDay">Tutto il giorno</Label>
          </div>

          <div className="flex items-center gap-2">
            <Controller
              name="publishExternally"
              control={control}
              render={({ field }) => (
                <Checkbox
                  id="publishExternally"
                  checked={field.value}
                  onCheckedChange={field.onChange}
                />
              )}
            />
            <Label htmlFor="publishExternally">Pubblica su Google Calendar</Label>
          </div>

          <div className="space-y-1">
            <Label htmlFor="item-description">Descrizione</Label>
            <Textarea
              id="item-description"
              {...register('description')}
              placeholder="Descrizione opzionale"
              rows={2}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>
              Annulla
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? 'Salvataggio…' : 'Salva'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
