'use client';

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import type { RouterOutputs } from '@luke/api';

import { Button } from '../../../../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../../../components/ui/dialog';
import { Input } from '../../../../../components/ui/input';
import { Label } from '../../../../../components/ui/label';
import { Textarea } from '../../../../../components/ui/textarea';
import { trpc } from '../../../../../lib/trpc';
import { getTrpcErrorMessage } from '../../../../../lib/trpcErrorMessages';

type Template = RouterOutputs['seasonCalendar']['listTemplates'][number];

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: (t: Template) => void;
  template?: Template | null;
}

interface FormValues {
  name: string;
  description: string;
}

export function TemplateDialog({ open, onClose, onSaved, template }: Props) {
  const isEdit = !!template;
  const { register, handleSubmit, reset, formState: { errors } } = useForm<FormValues>();

  useEffect(() => {
    if (open) {
      reset({
        name: template?.name ?? '',
        description: template?.description ?? '',
      });
    }
  }, [open, template?.id]);

  const createMutation = trpc.seasonCalendar.createTemplate.useMutation({
    onSuccess: t => { toast.success('Template creato'); onSaved(t as Template); },
    onError: err => toast.error(getTrpcErrorMessage(err)),
  });

  const updateMutation = trpc.seasonCalendar.updateTemplate.useMutation({
    onSuccess: t => { toast.success('Template aggiornato'); onSaved(t as Template); },
    onError: err => toast.error(getTrpcErrorMessage(err)),
  });

  const isPending = createMutation.isPending || updateMutation.isPending;

  const onSubmit = (values: FormValues) => {
    const payload = {
      name: values.name.trim(),
      description: values.description.trim() || undefined,
    };
    if (isEdit) {
      updateMutation.mutate({ id: template.id, ...payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Modifica template' : 'Nuovo template'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="name">Nome *</Label>
            <Input
              id="name"
              {...register('name', { required: 'Nome obbligatorio' })}
              placeholder="es. Stagione SS"
            />
            {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
          </div>
          <div className="space-y-1">
            <Label htmlFor="description">Descrizione</Label>
            <Textarea
              id="description"
              {...register('description')}
              placeholder="Descrizione opzionale"
              rows={3}
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
