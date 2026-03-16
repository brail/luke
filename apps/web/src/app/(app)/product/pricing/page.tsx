'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { PageHeader } from '../../../../components/PageHeader';
import { SectionCard } from '../../../../components/SectionCard';
import { useAppContext } from '../../../../contexts/AppContextProvider';
import { trpc } from '../../../../lib/trpc';
import { getTrpcErrorMessage } from '../../../../lib/trpcErrorMessages';

import { EmptyParameterState } from './_components/EmptyParameterState';
import { ParameterSetPanel } from './_components/ParameterSetPanel';
import { PricingCalculator } from './_components/PricingCalculator';

export default function PricingPage() {
  const { brand, season, isLoading: contextLoading } = useAppContext();
  const [selectedSetId, setSelectedSetId] = useState<string | null>(null);

  const enabled = !!brand?.id && !!season?.id;

  const {
    data: parameterSets = [],
    isLoading: setsLoading,
    error: setsError,
  } = trpc.pricing.parameterSets.list.useQuery(
    { brandId: brand?.id ?? '', seasonId: season?.id ?? '' },
    { enabled }
  );

  const utils = trpc.useUtils();

  // Quando brand/season cambia, resetta la selezione
  useEffect(() => {
    setSelectedSetId(null);
  }, [brand?.id, season?.id]);

  // Quando arrivano nuovi set, seleziona il default
  useEffect(() => {
    if (parameterSets.length > 0 && !selectedSetId) {
      const defaultSet =
        parameterSets.find(s => s.isDefault) ?? parameterSets[0];
      setSelectedSetId(defaultSet.id);
    }
  }, [parameterSets, selectedSetId]);

  const selectedSet =
    parameterSets.find(s => s.id === selectedSetId) ?? parameterSets[0] ?? null;

  const invalidateSets = () => {
    utils.pricing.parameterSets.list.invalidate({
      brandId: brand?.id,
      seasonId: season?.id,
    });
  };

  const createMutation = trpc.pricing.parameterSets.create.useMutation({
    onSuccess: data => {
      toast.success('Variante creata con successo');
      setSelectedSetId(data.id);
      invalidateSets();
    },
    onError: err =>
      toast.error(
        getTrpcErrorMessage(err, {
          CONFLICT: 'Una variante con questo nome esiste già',
        })
      ),
  });

  const updateMutation = trpc.pricing.parameterSets.update.useMutation({
    onSuccess: () => {
      toast.success('Parametri aggiornati');
      invalidateSets();
    },
    onError: err =>
      toast.error(
        getTrpcErrorMessage(err, {
          CONFLICT: 'Nome già in uso per questa stagione',
        })
      ),
  });

  const removeMutation = trpc.pricing.parameterSets.remove.useMutation({
    onSuccess: () => {
      toast.success('Variante eliminata');
      setSelectedSetId(null);
      invalidateSets();
    },
    onError: err => toast.error(getTrpcErrorMessage(err)),
  });

  const setDefaultMutation = trpc.pricing.parameterSets.setDefault.useMutation({
    onSuccess: data => {
      toast.success(`"${data.name}" impostata come default`);
      invalidateSets();
    },
    onError: err => toast.error(getTrpcErrorMessage(err)),
  });

  const isMutating =
    createMutation.isPending ||
    updateMutation.isPending ||
    removeMutation.isPending ||
    setDefaultMutation.isPending;

  const isLoading = contextLoading || setsLoading;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Costi e Prezzi" description="Caricamento..." />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Costi e Prezzi"
        description={
          brand && season
            ? `Parametri e calcolatrice per ${brand.name} — ${season.code} ${season.year}`
            : 'Calcolatrice prezzi basata sul contesto corrente'
        }
      />

      {setsError && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
          Errore nel caricamento dei parametri. {getTrpcErrorMessage(setsError)}
        </div>
      )}

      {!brand || !season ? (
        <SectionCard title="Contesto non selezionato">
          <p className="text-sm text-muted-foreground">
            Seleziona un brand e una stagione dalla barra in alto per usare la
            calcolatrice.
          </p>
        </SectionCard>
      ) : parameterSets.length === 0 ? (
        <SectionCard title="Parametri">
          <EmptyParameterState
            brandId={brand.id}
            seasonId={season.id}
            onCreateSet={data =>
              createMutation.mutate({
                brandId: brand.id,
                seasonId: season.id,
                data,
              })
            }
            isLoading={isMutating}
          />
        </SectionCard>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Parametri (colonna principale) */}
          <div className="lg:col-span-3 space-y-6">
            <SectionCard
              title="Calcolatrice"
              description="Calcola il prezzo retail, il prezzo acquisto massimo o il margine aziendale"
            >
              <PricingCalculator parameterSet={selectedSet} />
            </SectionCard>

            <SectionCard
              title="Parametri"
              description="Parametri di pricing per la combinazione brand+stagione corrente"
            >
              <ParameterSetPanel
                sets={parameterSets}
                selectedSetId={selectedSetId}
                onSelectSet={setSelectedSetId}
                onCreateSet={data =>
                  createMutation.mutate({
                    brandId: brand.id,
                    seasonId: season.id,
                    data,
                  })
                }
                onUpdateSet={(id, data) =>
                  updateMutation.mutate({
                    brandId: brand.id,
                    seasonId: season.id,
                    data: { ...data, id },
                  })
                }
                onDeleteSet={id =>
                  removeMutation.mutate({
                    id,
                    brandId: brand.id,
                    seasonId: season.id,
                  })
                }
                onSetDefault={id =>
                  setDefaultMutation.mutate({
                    id,
                    brandId: brand.id,
                    seasonId: season.id,
                  })
                }
                isLoading={isMutating}
              />
            </SectionCard>
          </div>
        </div>
      )}
    </div>
  );
}
