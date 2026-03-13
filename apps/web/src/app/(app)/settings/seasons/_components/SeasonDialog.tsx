'use client';

import React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import { SeasonInputSchema } from '@luke/core';

import { Button } from '../../../../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '../../../../../components/ui/dialog';
import { Input } from '../../../../../components/ui/input';
import { Label } from '../../../../../components/ui/label';
import { Switch } from '../../../../../components/ui/switch';

const SeasonFormSchema = SeasonInputSchema.extend({
  isActive: z.boolean(),
});

type SeasonFormData = z.infer<typeof SeasonFormSchema>;

interface Season {
  id: string;
  code: string;
  year: number;
  name: string;
  isActive: boolean;
}

interface SeasonDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  season?: Season | null;
  onSubmit: (data: SeasonFormData) => Promise<void>;
  isLoading?: boolean;
}

export function SeasonDialog({
  open,
  onOpenChange,
  season,
  onSubmit,
  isLoading,
}: SeasonDialogProps) {
  const isEditing = !!season;

  const form = useForm<SeasonFormData>({
    resolver: zodResolver(SeasonFormSchema),
    defaultValues: {
      code: '',
      year: new Date().getFullYear(),
      name: '',
      isActive: true,
    },
  });

  // Reset form quando il dialog si apre/chiude o cambia season
  React.useEffect(() => {
    if (open) {
      form.reset(
        season
          ? {
              code: season.code,
              year: season.year,
              name: season.name,
              isActive: season.isActive,
            }
          : {
              code: '',
              year: new Date().getFullYear(),
              name: '',
              isActive: true,
            }
      );
    }
    // intentionally limited to open: avoid stale closures on season changes
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubmit = async (data: SeasonFormData) => {
    await onSubmit(data);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? 'Modifica Stagione' : 'Nuova Stagione'}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            {/* Codice */}
            <div className="space-y-2">
              <Label htmlFor="code">Codice *</Label>
              <Input
                id="code"
                placeholder="es. FW"
                {...form.register('code')}
                disabled={isLoading}
              />
              {form.formState.errors.code && (
                <p className="text-sm text-destructive">
                  {form.formState.errors.code.message}
                </p>
              )}
            </div>

            {/* Anno */}
            <div className="space-y-2">
              <Label htmlFor="year">Anno *</Label>
              <Input
                id="year"
                type="number"
                placeholder="es. 2025"
                {...form.register('year', { valueAsNumber: true })}
                disabled={isLoading}
              />
              {form.formState.errors.year && (
                <p className="text-sm text-destructive">
                  {form.formState.errors.year.message}
                </p>
              )}
            </div>
          </div>

          {/* Nome */}
          <div className="space-y-2">
            <Label htmlFor="name">Nome *</Label>
            <Input
              id="name"
              placeholder="es. Autunno Inverno 2025"
              {...form.register('name')}
              disabled={isLoading}
            />
            {form.formState.errors.name && (
              <p className="text-sm text-destructive">
                {form.formState.errors.name.message}
              </p>
            )}
          </div>

          {/* Stato attivo */}
          <div className="flex items-center gap-3">
            <Switch
              id="isActive"
              checked={form.watch('isActive')}
              onCheckedChange={val => form.setValue('isActive', val)}
              disabled={isLoading}
            />
            <Label htmlFor="isActive">Stagione attiva</Label>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isLoading}
            >
              Annulla
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? 'Salvataggio...' : isEditing ? 'Aggiorna' : 'Crea'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
