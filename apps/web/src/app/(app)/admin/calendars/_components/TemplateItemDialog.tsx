'use client';

import { useEffect } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { toast } from 'sonner';

import type { RouterOutputs } from '@luke/api';
import { PLANNING_SECTION_KEYS, CALENDAR_MILESTONE_TYPE, type PlanningSectionKey } from '@luke/core';

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
import { SECTION_LABELS, TYPE_LABELS } from '../../../calendar/constants';

type TemplateItem = RouterOutputs['seasonCalendar']['listTemplates'][number]['items'][number];

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  templateId: string;
  item?: TemplateItem | null;
}

interface FormValues {
  title: string;
  type: (typeof CALENDAR_MILESTONE_TYPE)[number];
  ownerSectionKey: PlanningSectionKey;
  visibleSectionKeys: PlanningSectionKey[];
  offsetDays: number;
  durationDays: number;
  publishExternally: boolean;
  description: string;
}

export function TemplateItemDialog({ open, onClose, onSaved, templateId, item }: Props) {
  const isEdit = !!item;
  const { register, handleSubmit, reset, watch, setValue, control, formState: { errors } } = useForm<FormValues>();

  const ownerSectionKey = watch('ownerSectionKey');
  const visibleSectionKeys = watch('visibleSectionKeys') ?? [];

  useEffect(() => {
    if (open) {
      reset({
        title: item?.title ?? '',
        type: item?.type ?? 'MILESTONE',
        ownerSectionKey: (item?.ownerSectionKey as PlanningSectionKey) ?? 'planning.sales',
        visibleSectionKeys: item
          ? (item.visibleSectionKeys as PlanningSectionKey[])
          : ['planning.sales'],
        offsetDays: item?.offsetDays ?? 0,
        durationDays: item?.durationDays ?? 0,
        publishExternally: item?.publishExternally ?? true,
        description: item?.description ?? '',
      });
    }
  }, [open, item?.id]);

  useEffect(() => {
    if (ownerSectionKey && !visibleSectionKeys.includes(ownerSectionKey)) {
      setValue('visibleSectionKeys', [...visibleSectionKeys, ownerSectionKey]);
    }
  }, [ownerSectionKey]); // intentional: only sync when owner changes, not on visibleSectionKeys change

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
      ownerSectionKey: values.ownerSectionKey,
      visibleSectionKeys: values.visibleSectionKeys,
      offsetDays: Number(values.offsetDays),
      durationDays: Number(values.durationDays),
      publishExternally: values.publishExternally,
      description: values.description.trim() || undefined,
    };
    if (isEdit) {
      updateMutation.mutate({ id: item.id, ...payload });
    } else {
      createMutation.mutate({ templateId, ...payload });
    }
  };

  const toggleVisible = (sk: PlanningSectionKey) => {
    if (sk === ownerSectionKey) return; // owner locked
    const current = visibleSectionKeys;
    setValue(
      'visibleSectionKeys',
      current.includes(sk) ? current.filter(s => s !== sk) : [...current, sk]
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
                      {CALENDAR_MILESTONE_TYPE.map(t => (
                        <SelectItem key={t} value={t}>{TYPE_LABELS[t] ?? t}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>

            <div className="space-y-1">
              <Label>Sezione owner *</Label>
              <Controller
                name="ownerSectionKey"
                control={control}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {PLANNING_SECTION_KEYS.map(sk => (
                        <SelectItem key={sk} value={sk}>{SECTION_LABELS[sk]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
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

          <div className="space-y-2">
            <Label>Visibile a</Label>
            <div className="flex flex-wrap gap-3">
              {PLANNING_SECTION_KEYS.map(sk => (
                <label key={sk} className="flex items-center gap-1.5 cursor-pointer">
                  <Checkbox
                    checked={visibleSectionKeys.includes(sk)}
                    onCheckedChange={() => toggleVisible(sk)}
                    disabled={sk === ownerSectionKey}
                  />
                  <span className="text-sm">{SECTION_LABELS[sk]}</span>
                </label>
              ))}
            </div>
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
