'use client';

import { Copy, Plus } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import type { PricingParameterSetInput } from '@luke/core';

import { Button } from '../../../../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../../../components/ui/dialog';
import { usePermission } from '../../../../../hooks/usePermission';
import { trpc } from '../../../../../lib/trpc';

import { ParameterSetDialog } from './ParameterSetDialog';

interface EmptyParameterStateProps {
  brandId: string;
  seasonId: string;
  onCreateSet: (data: PricingParameterSetInput) => void;
  isLoading?: boolean;
}

export function EmptyParameterState({
  brandId,
  seasonId,
  onCreateSet,
  isLoading = false,
}: EmptyParameterStateProps) {
  const { can } = usePermission();
  const canUpdate = can('pricing:update');

  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isCopyPreviewOpen, setIsCopyPreviewOpen] = useState(false);

  const previousQuery =
    trpc.pricing.parameterSets.copyFromPreviousSeason.useQuery(
      { brandId, seasonId },
      { retry: false }
    );

  const hasPrevious = !!previousQuery.data;
  const previousSeason = previousQuery.data?.season;
  const previousSets = previousQuery.data?.sets ?? [];

  const handleCopyAndCreate = () => {
    // Crea tutte le varianti copiando dalla stagione precedente
    for (const s of previousSets) {
      onCreateSet({
        name: s.name,
        purchaseCurrency: s.purchaseCurrency,
        sellingCurrency: s.sellingCurrency,
        qualityControlPercent: s.qualityControlPercent,
        transportInsuranceCost: s.transportInsuranceCost,
        duty: s.duty,
        exchangeRate: s.exchangeRate,
        italyAccessoryCosts: s.italyAccessoryCosts,
        tools: s.tools,
        retailMultiplier: s.retailMultiplier,
        optimalMargin: s.optimalMargin,
      });
    }
    toast.success(
      `${previousSets.length} variante${previousSets.length > 1 ? 'i' : ''} copiate da ${previousSeason?.code} ${previousSeason?.year}`
    );
    setIsCopyPreviewOpen(false);
  };

  return (
    <div className="flex flex-col items-center justify-center py-12 text-center space-y-4">
      <div className="rounded-full bg-muted p-4">
        <Plus className="h-8 w-8 text-muted-foreground" />
      </div>
      <div className="space-y-1">
        <h3 className="text-lg font-semibold">Nessun parametro configurato</h3>
        <p className="text-sm text-muted-foreground max-w-sm">
          Non esistono parametri di pricing per la combinazione brand+stagione
          corrente. Configura i parametri per iniziare a usare la calcolatrice.
        </p>
      </div>

      <div className="flex gap-3 flex-wrap justify-center">
        {hasPrevious && (
          <Button
            variant="outline"
            onClick={() => setIsCopyPreviewOpen(true)}
            disabled={!canUpdate || isLoading}
          >
            <Copy className="h-4 w-4 mr-2" />
            Copia da {previousSeason?.code} {previousSeason?.year}
          </Button>
        )}
        <Button
          onClick={() => setIsCreateDialogOpen(true)}
          disabled={!canUpdate || isLoading}
        >
          <Plus className="h-4 w-4 mr-2" />
          Inserisci da zero
        </Button>
      </div>

      {/* Dialog conferma copia */}
      <Dialog open={isCopyPreviewOpen} onOpenChange={setIsCopyPreviewOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              Copia parametri da {previousSeason?.code} {previousSeason?.year}
            </DialogTitle>
            <DialogDescription>
              Verranno copiate {previousSets.length} variant
              {previousSets.length > 1 ? 'i' : 'e'}:
            </DialogDescription>
          </DialogHeader>

          <ul className="space-y-1 text-sm">
            {previousSets.map(s => (
              <li key={s.id} className="flex justify-between border-b py-1">
                <span className="font-medium">{s.name}</span>
                <span className="text-muted-foreground">
                  Margine {s.optimalMargin}% — ×{s.retailMultiplier}
                </span>
              </li>
            ))}
          </ul>

          <p className="text-sm text-muted-foreground">
            Potrai modificare i parametri dopo la copia.
          </p>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsCopyPreviewOpen(false)}
            >
              Annulla
            </Button>
            <Button onClick={handleCopyAndCreate} disabled={!canUpdate || isLoading}>
              Conferma copia
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog crea da zero */}
      <ParameterSetDialog
        open={isCreateDialogOpen}
        onOpenChange={setIsCreateDialogOpen}
        mode="create"
        onSubmit={data => {
          onCreateSet(data);
          setIsCreateDialogOpen(false);
        }}
        isLoading={isLoading}
      />
    </div>
  );
}
