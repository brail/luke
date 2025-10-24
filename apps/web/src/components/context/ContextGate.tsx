'use client';

import React, { useState } from 'react';

import { useAppContext } from '../../contexts/AppContextProvider';
import { useContextMutation } from '../../contexts/useContextMutation';
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';
import { Skeleton } from '../ui/skeleton';

import { BrandAvatar } from './BrandAvatar';

/**
 * Modale bloccante per la selezione iniziale del context
 *
 * Appare quando non ci sono Brand o Season attivi (FAILED_PRECONDITION).
 * Non può essere chiusa finché non viene selezionato un Brand e Season validi.
 */
export function ContextGate() {
  const { needsSetup } = useAppContext();
  const { setContext, isPending } = useContextMutation();

  // Stato locale per la selezione nella modale
  const [selectedBrandId, setSelectedBrandId] = useState<string>('');
  const [selectedSeasonId, setSelectedSeasonId] = useState<string>('');

  // Query per ottenere le liste di Brand e Season
  const { data: brands = [], isLoading: brandsLoading } =
    trpc.catalog.brands.useQuery();
  const { data: seasons = [], isLoading: seasonsLoading } =
    trpc.catalog.seasons.useQuery();

  // Handler per conferma selezione
  const handleConfirm = async () => {
    if (selectedBrandId && selectedSeasonId) {
      try {
        await setContext({
          brandId: selectedBrandId,
          seasonId: selectedSeasonId,
        });
        // La modale si chiuderà automaticamente quando needsSetup diventa false
      } catch (error) {
        // L'errore è già gestito da useStandardMutation
        console.error('Errore durante la selezione del context:', error);
      }
    }
  };

  // Determina se il bottone conferma è abilitato
  const isConfirmEnabled = selectedBrandId && selectedSeasonId && !isPending;

  // Loading state
  if (brandsLoading || seasonsLoading) {
    return (
      <Dialog open={needsSetup} onOpenChange={() => {}}>
        <DialogContent
          className="sm:max-w-[500px]"
          onInteractOutside={e => e.preventDefault()}
          onEscapeKeyDown={e => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>Configurazione Contesto</DialogTitle>
            <DialogDescription>
              Caricamento delle opzioni disponibili...
            </DialogDescription>
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
    <Dialog open={needsSetup} onOpenChange={() => {}}>
      <DialogContent
        className="sm:max-w-[500px]"
        onInteractOutside={e => e.preventDefault()}
        onEscapeKeyDown={e => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Seleziona Contesto</DialogTitle>
          <DialogDescription>
            È necessario selezionare un Brand e una Season per continuare.
            Questa selezione determinerà il contesto di lavoro per
            l&apos;applicazione.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Brand Selector */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Brand</label>
            <Select
              value={selectedBrandId}
              onValueChange={setSelectedBrandId}
              disabled={isPending}
            >
              <SelectTrigger>
                <SelectValue placeholder="Seleziona un brand">
                  {selectedBrandId &&
                    brands.find(b => b.id === selectedBrandId) && (
                      <div className="flex items-center gap-2">
                        <BrandAvatar
                          logoUrl={
                            brands.find(b => b.id === selectedBrandId)
                              ?.logoUrl || null
                          }
                          code={
                            brands.find(b => b.id === selectedBrandId)?.code ||
                            ''
                          }
                          size="sm"
                        />
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
                      <BrandAvatar
                        logoUrl={brand.logoUrl}
                        code={brand.code}
                        size="sm"
                      />
                      <span>
                        {brand.code} - {brand.name}
                      </span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Season Selector */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Season</label>
            <Select
              value={selectedSeasonId}
              onValueChange={setSelectedSeasonId}
              disabled={isPending}
            >
              <SelectTrigger>
                <SelectValue placeholder="Seleziona una season">
                  {selectedSeasonId &&
                    seasons.find(s => s.id === selectedSeasonId) && (
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
          </div>

          {/* Conferma Button */}
          <div className="flex justify-end pt-4">
            <Button
              onClick={handleConfirm}
              disabled={!isConfirmEnabled}
              className="min-w-[120px]"
            >
              {isPending ? 'Configurazione...' : 'Conferma'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
