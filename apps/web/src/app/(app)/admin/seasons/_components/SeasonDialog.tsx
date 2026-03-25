'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import React from 'react';
import { useForm } from 'react-hook-form';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../../../components/ui/select';
import { Switch } from '../../../../../components/ui/switch';
import { trpc } from '../../../../../lib/trpc';

const SeasonFormSchema = SeasonInputSchema.extend({
  isActive: z.boolean(),
  year: z.number().int().min(2000).max(2100).nullable().optional(),
  navSeasonId: z.string().nullable().optional(),
});

type SeasonFormData = z.infer<typeof SeasonFormSchema>;

export interface SeasonItem {
  id: string;
  code: string;
  year: number | null;
  name: string;
  navSeasonId: string | null;
  isActive: boolean;
  updatedAt: string;
}

interface SeasonDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  season?: SeasonItem | null;
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

  const { data: navSeasons = [] } = trpc.integrations.nav.seasons.list.useQuery(
    { excludeLinkedTo: season?.navSeasonId ?? undefined },
    { staleTime: 5 * 60 * 1000 }
  );

  const form = useForm<SeasonFormData>({
    resolver: zodResolver(SeasonFormSchema),
    defaultValues: {
      code: '',
      year: null,
      name: '',
      navSeasonId: null,
      isActive: true,
    },
  });

  React.useEffect(() => {
    if (open) {
      form.reset(
        season
          ? {
              code: season.code,
              year: season.year ?? null,
              name: season.name,
              navSeasonId: season.navSeasonId ?? null,
              isActive: season.isActive,
            }
          : {
              code: '',
              year: null,
              name: '',
              navSeasonId: null,
              isActive: true,
            }
      );
    }
  }, [open]);

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
              <Label htmlFor="code" className="flex items-center gap-2">
                Codice *
                {season?.navSeasonId && (
                  <span className="text-xs font-normal text-muted-foreground bg-muted px-1.5 py-0.5 rounded">da NAV</span>
                )}
              </Label>
              <Input
                id="code"
                placeholder="es. FW26"
                {...form.register('code')}
                disabled={isLoading || !!season?.navSeasonId}
              />
              {form.formState.errors.code && (
                <p className="text-sm text-destructive">
                  {form.formState.errors.code.message}
                </p>
              )}
            </div>

            {/* Anno (opzionale, descrittivo) */}
            <div className="space-y-2">
              <Label htmlFor="year">Anno</Label>
              <Input
                id="year"
                type="number"
                placeholder="es. 2026"
                {...form.register('year', {
                  setValueAs: v => (v === '' || v === null || isNaN(Number(v)) ? null : Number(v)),
                })}
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
            <Label htmlFor="name" className="flex items-center gap-2">
              Nome *
              {season?.navSeasonId && (
                <span className="text-xs font-normal text-muted-foreground bg-muted px-1.5 py-0.5 rounded">da NAV</span>
              )}
            </Label>
            <Input
              id="name"
              placeholder="es. Autunno Inverno 2026"
              {...form.register('name')}
              disabled={isLoading || !!season?.navSeasonId}
            />
            {form.formState.errors.name && (
              <p className="text-sm text-destructive">
                {form.formState.errors.name.message}
              </p>
            )}
          </div>

          {/* Collega a NAV */}
          {season?.navSeasonId ? (
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                Collegamento NAV
                <span className="text-xs font-normal text-blue-600 bg-blue-50 border border-blue-200 px-1.5 py-0.5 rounded">collegato</span>
              </Label>
              <div className="flex h-9 items-center rounded-md border bg-muted px-3 text-sm font-mono text-muted-foreground">
                {season.navSeasonId}
              </div>
              <p className="text-xs text-muted-foreground">
                Collegamento bloccato. Usa "Scollega da NAV" per rimuoverlo.
              </p>
            </div>
          ) : navSeasons.length > 0 && (
            <div className="space-y-2">
              <Label>Collega a NAV</Label>
              <Select
                value={form.watch('navSeasonId') ?? '__none__'}
                onValueChange={v => form.setValue('navSeasonId', v === '__none__' ? null : v)}
                disabled={isLoading}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Nessun collegamento NAV" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Nessun collegamento NAV</SelectItem>
                  {navSeasons.map(s => (
                    <SelectItem key={s.navCode} value={s.navCode}>
                      {s.navCode} — {s.description}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

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
