'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import { BrandInputSchema, SeasonInputSchema, normalizeCode } from '@luke/core';

import { useAppContext } from '../../contexts/AppContextProvider';
import { useContextMutation } from '../../contexts/useContextMutation';
import { usePermission } from '../../hooks/usePermission';
import { trpc } from '../../lib/trpc';
import { Button } from '../ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '../ui/form';
import { Input } from '../ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';
import { Skeleton } from '../ui/skeleton';

import { BrandAvatar } from './BrandAvatar';

/** The two fields the inline brand form collects; the core schema already carries Italian copy. */
const BrandCreateFormSchema = BrandInputSchema.pick({ code: true, name: true });

type BrandCreateFormData = z.infer<typeof BrandCreateFormSchema>;

interface SeasonCreateFormData {
  code: string;
  name: string;
  year: string;
}

/**
 * The inline season form. `year` is held as a string because that is what the number input gives,
 * and it is optional — parsed on submit, where `SeasonInputSchema`'s own range applies. Declared
 * rather than inferred: the refine makes this a ZodEffects, whose inferred type does not survive
 * the resolver's generics cleanly.
 */
const SeasonCreateFormSchema: z.ZodType<SeasonCreateFormData, SeasonCreateFormData> =
  SeasonInputSchema.pick({ code: true, name: true }).extend({
    year: z
      .string()
      .refine(
        value => value === '' || (/^\d{4}$/.test(value) && Number(value) >= 2000 && Number(value) <= 2100),
        'Anno non valido'
      ),
  });

/**
 * Modale bloccante per la selezione iniziale del context
 *
 * Appare quando non ci sono Brand o Season attivi (FAILED_PRECONDITION).
 * Non può essere chiusa finché non viene selezionato un Brand e Season validi.
 * Se il DB è vuoto, offre la creazione inline di brand/season (solo per chi ha i permessi).
 */
export function ContextGate() {
  const { needsSetup } = useAppContext();
  const { setContext, isPending } = useContextMutation();
  const { can } = usePermission();
  const utils = trpc.useUtils();

  // Selezione context
  const [selectedBrandId, setSelectedBrandId] = useState<string>('');
  const [selectedSeasonId, setSelectedSeasonId] = useState<string>('');

  // Mini form brand
  const brandForm = useForm<BrandCreateFormData>({
    resolver: zodResolver(BrandCreateFormSchema),
    defaultValues: { code: '', name: '' },
  });

  // Mini form season
  const seasonForm = useForm<SeasonCreateFormData>({
    resolver: zodResolver(SeasonCreateFormSchema),
    defaultValues: { code: '', name: '', year: '' },
  });

  const { data: brands = [], isLoading: brandsLoading } =
    trpc.catalog.brands.useQuery(undefined, { enabled: needsSetup });

  const { data: seasons = [], isLoading: seasonsLoading } =
    trpc.catalog.seasons.useQuery(undefined, { enabled: needsSetup });

  const createBrandMutation = trpc.brand.create.useMutation({
    onSuccess: brand => {
      utils.catalog.brands.invalidate();
      setSelectedBrandId(brand.id);
      brandForm.reset();
      toast.success(`Brand "${brand.name}" creato`);
    },
    onError: () => toast.error('Errore durante la creazione del brand'),
  });

  const createSeasonMutation = trpc.season.create.useMutation({
    onSuccess: season => {
      utils.catalog.seasons.invalidate();
      setSelectedSeasonId(season.id);
      seasonForm.reset();
      toast.success(`Stagione "${season.code}" creata`);
    },
    onError: () => toast.error('Errore durante la creazione della stagione'),
  });

  const handleConfirm = async () => {
    if (selectedBrandId && selectedSeasonId) {
      try {
        await setContext({ brandId: selectedBrandId, seasonId: selectedSeasonId });
      } catch {
        // L'errore è già gestito da useContextMutation
      }
    }
  };

  const handleCreateBrand = (data: BrandCreateFormData) => {
    createBrandMutation.mutate({ code: data.code, name: data.name.trim(), isActive: true });
  };

  const handleCreateSeason = (data: SeasonCreateFormData) => {
    createSeasonMutation.mutate({
      code: data.code,
      name: data.name.trim(),
      year: data.year ? Number.parseInt(data.year, 10) : undefined,
      isActive: true,
    });
  };

  // Un brand è disponibile se ci sono brands nella lista O se è appena stato creato (selectedBrandId è set)
  const noBrands = !brandsLoading && brands.length === 0 && !selectedBrandId;
  const noSeasons = !!selectedBrandId && !seasonsLoading && seasons.length === 0 && !selectedSeasonId;
  const isConfirmEnabled = selectedBrandId && selectedSeasonId && !isPending;

  const dialogProps = {
    open: needsSetup,
    onOpenChange: () => {},
  } as const;

  const contentProps = {
    className: 'sm:max-w-[500px]', // px: dialog width tuned to this form's content; no exact Tailwind max-w scale match
    onInteractOutside: (e: globalThis.Event) => e.preventDefault(),
    onEscapeKeyDown: (e: KeyboardEvent) => e.preventDefault(),
  } as const;

  if (brandsLoading || (!!selectedBrandId && seasonsLoading)) {
    return (
      <Dialog {...dialogProps}>
        <DialogContent {...contentProps}>
          <DialogHeader>
            <DialogTitle>Configurazione Contesto</DialogTitle>
            <DialogDescription>Caricamento delle opzioni disponibili...</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog {...dialogProps}>
      <DialogContent {...contentProps}>
        <DialogHeader>
          <DialogTitle>Seleziona Contesto</DialogTitle>
          <DialogDescription>
            È necessario selezionare un Brand e una Season per continuare.
            Questa selezione determinerà il contesto di lavoro per l&apos;applicazione.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Brand */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Brand</label>
            {noBrands ? (
              can('brands:create') ? (
                <Form {...brandForm}>
                  <form
                    onSubmit={brandForm.handleSubmit(handleCreateBrand)}
                    className="rounded-lg border bg-muted/30 p-4 space-y-3"
                  >
                    <p className="text-sm text-muted-foreground">
                      Nessun brand disponibile. Creane uno per continuare.
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      <FormField
                        control={brandForm.control}
                        name="code"
                        render={({ field }) => (
                          <FormItem className="space-y-1">
                            <FormLabel className="text-xs">Codice</FormLabel>
                            <FormControl>
                              <Input
                                placeholder="es. NIKE"
                                disabled={createBrandMutation.isPending}
                                {...field}
                                // Normalised as it is typed, so what the field shows is what gets
                                // validated and sent — it used to be normalised only on submit.
                                onChange={e => field.onChange(normalizeCode(e.target.value))}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={brandForm.control}
                        name="name"
                        render={({ field }) => (
                          <FormItem className="space-y-1">
                            <FormLabel className="text-xs">Nome</FormLabel>
                            <FormControl>
                              <Input
                                placeholder="es. Nike"
                                disabled={createBrandMutation.isPending}
                                {...field}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                    <Button type="submit" size="sm" disabled={createBrandMutation.isPending}>
                      {createBrandMutation.isPending ? 'Creazione...' : 'Crea Brand'}
                    </Button>
                  </form>
                </Form>
              ) : (
                <p className="text-sm text-muted-foreground rounded-lg border p-3">
                  Nessun brand disponibile. Contatta un amministratore per configurare il sistema.
                </p>
              )
            ) : (
              <Select
                value={selectedBrandId}
                onValueChange={v => {
                  setSelectedBrandId(v);
                  setSelectedSeasonId('');
                }}
                disabled={isPending}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Seleziona un brand">
                    {selectedBrandId && brands.find(b => b.id === selectedBrandId) && (
                      <div className="flex items-center gap-2">
                        <BrandAvatar brand={brands.find(b => b.id === selectedBrandId)!} size="sm" />
                        <span>
                          {brands.find(b => b.id === selectedBrandId)?.code} -{' '}
                          {brands.find(b => b.id === selectedBrandId)?.name}
                        </span>
                      </div>
                    )}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {brands.map(brand => (
                    <SelectItem key={brand.id} value={brand.id}>
                      <div className="flex items-center gap-2">
                        <BrandAvatar brand={brand} size="sm" />
                        <span>{brand.code} - {brand.name}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* Season — mostrata solo quando c'è un brand selezionato */}
          {!noBrands && !!selectedBrandId && (
            <div className="space-y-2">
              <label className="text-sm font-medium">Season</label>
              {noSeasons ? (
                can('seasons:create') ? (
                  <Form {...seasonForm}>
                    <form
                      onSubmit={seasonForm.handleSubmit(handleCreateSeason)}
                      className="rounded-lg border bg-muted/30 p-4 space-y-3"
                    >
                      <p className="text-sm text-muted-foreground">
                        Nessuna stagione disponibile. Creane una per continuare.
                      </p>
                      <div className="grid grid-cols-3 gap-2">
                        <FormField
                          control={seasonForm.control}
                          name="code"
                          render={({ field }) => (
                            <FormItem className="space-y-1">
                              <FormLabel className="text-xs">Codice</FormLabel>
                              <FormControl>
                                <Input
                                  placeholder="es. FW25"
                                  disabled={createSeasonMutation.isPending}
                                  {...field}
                                  onChange={e => field.onChange(normalizeCode(e.target.value))}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={seasonForm.control}
                          name="name"
                          render={({ field }) => (
                            <FormItem className="space-y-1">
                              <FormLabel className="text-xs">Nome</FormLabel>
                              <FormControl>
                                <Input
                                  placeholder="es. Fall/Winter"
                                  disabled={createSeasonMutation.isPending}
                                  {...field}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={seasonForm.control}
                          name="year"
                          render={({ field }) => (
                            <FormItem className="space-y-1">
                              <FormLabel className="text-xs">Anno</FormLabel>
                              <FormControl>
                                <Input
                                  placeholder="es. 2025"
                                  type="number"
                                  disabled={createSeasonMutation.isPending}
                                  {...field}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>
                      <Button type="submit" size="sm" disabled={createSeasonMutation.isPending}>
                        {createSeasonMutation.isPending ? 'Creazione...' : 'Crea Stagione'}
                      </Button>
                    </form>
                  </Form>
                ) : (
                  <p className="text-sm text-muted-foreground rounded-lg border p-3">
                    Nessuna stagione disponibile. Contatta un amministratore per configurare il sistema.
                  </p>
                )
              ) : (
                <Select
                  value={selectedSeasonId}
                  onValueChange={setSelectedSeasonId}
                  disabled={isPending}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Seleziona una season">
                      {selectedSeasonId && seasons.find(s => s.id === selectedSeasonId) && (
                        <span>
                          {seasons.find(s => s.id === selectedSeasonId)?.code}{' '}
                          {seasons.find(s => s.id === selectedSeasonId)?.year} -{' '}
                          {seasons.find(s => s.id === selectedSeasonId)?.name}
                        </span>
                      )}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {seasons.map(season => (
                      <SelectItem key={season.id} value={season.id}>
                        <span>
                          {season.code} {season.year} - {season.name}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          )}

          {/* Conferma */}
          <div className="flex justify-end pt-4">
            <Button
              onClick={handleConfirm}
              disabled={!isConfirmEnabled}
              className="min-w-[120px]" // px: keeps button width stable across "Conferma"/"Configurazione..." label change; no exact scale match
            >
              {isPending ? 'Configurazione...' : 'Conferma'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
