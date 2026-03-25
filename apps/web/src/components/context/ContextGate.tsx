'use client';

import React, { useState } from 'react';
import { toast } from 'sonner';

import { normalizeCode } from '@luke/core';

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
import { Input } from '../ui/input';
import { Label } from '../ui/label';
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
  const [newBrandCode, setNewBrandCode] = useState('');
  const [newBrandName, setNewBrandName] = useState('');

  // Mini form season
  const [newSeasonCode, setNewSeasonCode] = useState('');
  const [newSeasonName, setNewSeasonName] = useState('');
  const [newSeasonYear, setNewSeasonYear] = useState('');

  const { data: brands = [], isLoading: brandsLoading } =
    trpc.catalog.brands.useQuery(undefined, { enabled: needsSetup });

  const { data: seasons = [], isLoading: seasonsLoading } =
    trpc.catalog.seasons.useQuery(
      { brandId: selectedBrandId || undefined },
      { enabled: needsSetup && !!selectedBrandId }
    );

  const createBrandMutation = trpc.brand.create.useMutation({
    onSuccess: brand => {
      utils.catalog.brands.invalidate();
      setSelectedBrandId(brand.id);
      setNewBrandCode('');
      setNewBrandName('');
      toast.success(`Brand "${brand.name}" creato`);
    },
    onError: () => toast.error('Errore durante la creazione del brand'),
  });

  const createSeasonMutation = trpc.season.create.useMutation({
    onSuccess: season => {
      utils.catalog.seasons.invalidate();
      setSelectedSeasonId(season.id);
      setNewSeasonCode('');
      setNewSeasonName('');
      setNewSeasonYear('');
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

  const handleCreateBrand = () => {
    const code = normalizeCode(newBrandCode);
    if (!code || !newBrandName.trim()) return;
    createBrandMutation.mutate({ code, name: newBrandName.trim(), isActive: true });
  };

  const handleCreateSeason = () => {
    const code = normalizeCode(newSeasonCode);
    if (!code || !newSeasonName.trim()) return;
    const year = newSeasonYear ? parseInt(newSeasonYear, 10) : undefined;
    createSeasonMutation.mutate({ code, name: newSeasonName.trim(), year, isActive: true });
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
    className: 'sm:max-w-[500px]',
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
                <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Nessun brand disponibile. Creane uno per continuare.
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-xs">Codice</Label>
                      <Input
                        placeholder="es. NIKE"
                        value={newBrandCode}
                        onChange={e => setNewBrandCode(e.target.value)}
                        disabled={createBrandMutation.isPending}
                        onKeyDown={e => e.key === 'Enter' && handleCreateBrand()}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Nome</Label>
                      <Input
                        placeholder="es. Nike"
                        value={newBrandName}
                        onChange={e => setNewBrandName(e.target.value)}
                        disabled={createBrandMutation.isPending}
                        onKeyDown={e => e.key === 'Enter' && handleCreateBrand()}
                      />
                    </div>
                  </div>
                  <Button
                    size="sm"
                    onClick={handleCreateBrand}
                    disabled={!newBrandCode.trim() || !newBrandName.trim() || createBrandMutation.isPending}
                  >
                    {createBrandMutation.isPending ? 'Creazione...' : 'Crea Brand'}
                  </Button>
                </div>
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
                  <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
                    <p className="text-sm text-muted-foreground">
                      Nessuna stagione disponibile. Creane una per continuare.
                    </p>
                    <div className="grid grid-cols-3 gap-2">
                      <div className="space-y-1">
                        <Label className="text-xs">Codice</Label>
                        <Input
                          placeholder="es. FW25"
                          value={newSeasonCode}
                          onChange={e => setNewSeasonCode(e.target.value)}
                          disabled={createSeasonMutation.isPending}
                          onKeyDown={e => e.key === 'Enter' && handleCreateSeason()}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Nome</Label>
                        <Input
                          placeholder="es. Fall/Winter"
                          value={newSeasonName}
                          onChange={e => setNewSeasonName(e.target.value)}
                          disabled={createSeasonMutation.isPending}
                          onKeyDown={e => e.key === 'Enter' && handleCreateSeason()}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Anno</Label>
                        <Input
                          placeholder="es. 2025"
                          type="number"
                          value={newSeasonYear}
                          onChange={e => setNewSeasonYear(e.target.value)}
                          disabled={createSeasonMutation.isPending}
                          onKeyDown={e => e.key === 'Enter' && handleCreateSeason()}
                        />
                      </div>
                    </div>
                    <Button
                      size="sm"
                      onClick={handleCreateSeason}
                      disabled={!newSeasonCode.trim() || !newSeasonName.trim() || createSeasonMutation.isPending}
                    >
                      {createSeasonMutation.isPending ? 'Creazione...' : 'Crea Stagione'}
                    </Button>
                  </div>
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
