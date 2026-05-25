'use client';

import { useEffect } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { toast } from 'sonner';

import type { RouterOutputs } from '@luke/api';

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

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  templateId: string;
  item?: TemplateItem | null;
  availableFunctions: { id: string; name: string }[];
}

interface FormValues {
  title: string;
  type: string;
  ownerFunctionId: string;
  visibilityFunctionIds: string[];
  offsetDays: number;
  durationDays: number;
  publishExternally: boolean;
  description: string;
}

export function TemplateItemDialog({ open, onClose, onSaved, templateId, item, availableFunctions }: Props) {
  const isEdit = !!item;
  const defaultOwner = availableFunctions[0]?.id ?? '';
  const { register, handleSubmit, reset, watch, setValue, control, formState: { errors } } = useForm<FormValues>();

  const { data: catalogItems = [] } = trpc.calendarCatalog.list.useQuery(
    { type: 'eventType' },
    { staleTime: 5 * 60 * 1000 }
  );

  const ownerFunctionId = watch('ownerFunctionId');
  const visibilityFunctionIds = watch('visibilityFunctionIds') ?? [];

  useEffect(() => {
    if (open) {
      const owner = item?.ownerFunctionId ?? defaultOwner;
      reset({
        title: item?.title ?? '',
        type: item?.type ?? 'MILESTONE',
        ownerFunctionId: owner,
        visibilityFunctionIds: item
          ? (item.visibilities?.map(v => v.functionId) ?? [owner])
          : [owner],
        offsetDays: item?.offsetDays ?? 0,
        durationDays: item?.durationDays ?? 0,
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
      ownerFunctionId: values.ownerFunctionId,
      visibilityFunctionIds: values.visibilityFunctionIds,
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
