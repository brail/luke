'use client';

import { useCallback, useEffect, useMemo } from 'react';

import type { RouterOutputs } from '@luke/api';
import type { CollectionLayoutRowInput } from '@luke/core';

import type { UseFormReturn } from 'react-hook-form';

/** Set di parametri pricing come restituito dal router. */
export type PricingParameterSet =
  RouterOutputs['pricing']['parameterSets']['list'][number];

/** Risultato del calcolo marginalità lato client. */
export interface MarginCalc {
  landedCost: number;
  wholesalePrice: number;
  companyMargin: number;
  isAboveTarget: boolean;
  optimalMargin: number;
}

/**
 * Calcola marginalità e buying target in base ai parametri pricing selezionati.
 * Replica la logica di pricing.service.ts lato client per feedback immediato
 * senza round-trip al server.
 *
 * @param form - Instance react-hook-form del form riga
 * @param parameterSets - Lista set parametri pricing disponibili
 * @returns selectedParamSet e marginCalc aggiornati reattivamente
 */
export function usePricingCalc(
  form: UseFormReturn<CollectionLayoutRowInput>,
  parameterSets: PricingParameterSet[]
): {
  selectedParamSet: PricingParameterSet | null;
  marginCalc: MarginCalc | null;
} {
  const watchedPricingSetId = form.watch('pricingParameterSetId');
  const watchedSupplierQuotation = form.watch('supplierFirstQuotation');
  const watchedRetailPrice = form.watch('retailTargetPrice');

  const selectedParamSet = useMemo(
    () =>
      watchedPricingSetId
        ? (parameterSets.find(ps => ps.id === watchedPricingSetId) ?? null)
        : null,
    [watchedPricingSetId, parameterSets]
  );

  const companyMultiplier = useMemo(
    () =>
      selectedParamSet
        ? Math.round((1 / (1 - selectedParamSet.optimalMargin / 100)) * 100) / 100
        : null,
    [selectedParamSet]
  );

  /** Calcola landed cost da quotazione fornitore FOB. */
  const landedCostCalc = useCallback(
    (quotation: number, ps: PricingParameterSet | null): number | null => {
      if (!ps) return null;
      const qc = quotation * (ps.qualityControlPercent / 100);
      const withQC = quotation + qc + ps.tools;
      const withTransport = withQC + ps.transportInsuranceCost;
      const withDuty = withTransport * (1 + ps.duty / 100);
      return withDuty / ps.exchangeRate + ps.italyAccessoryCosts;
    },
    []
  );

  /** Calcola buying target invertendo la formula dal retail price. */
  const buyingTargetCalc = useCallback(
    (
      retail: number,
      ps: PricingParameterSet | null,
      cm: number | null
    ): number | null => {
      if (!ps || !cm) return null;
      const wholesale = retail / ps.retailMultiplier;
      const landed = wholesale / cm;
      const withoutAcc = landed - ps.italyAccessoryCosts;
      const withoutDuty = withoutAcc / (1 + ps.duty / 100);
      const withoutTransport =
        withoutDuty * ps.exchangeRate - ps.transportInsuranceCost;
      const raw =
        withoutTransport / (1 + ps.qualityControlPercent / 100) - ps.tools;
      return Math.floor(raw * 10) / 10;
    },
    []
  );

  const marginCalc = useMemo((): MarginCalc | null => {
    if (
      !selectedParamSet ||
      !companyMultiplier ||
      !watchedSupplierQuotation ||
      !watchedRetailPrice ||
      watchedSupplierQuotation <= 0 ||
      watchedRetailPrice <= 0
    ) {
      return null;
    }
    const landed = landedCostCalc(watchedSupplierQuotation, selectedParamSet);
    if (landed === null) return null;
    const wholesale = watchedRetailPrice / selectedParamSet.retailMultiplier;
    const margin = (wholesale - landed) / wholesale;
    return {
      landedCost: Math.round(landed * 100) / 100,
      wholesalePrice: Math.round(wholesale * 100) / 100,
      companyMargin: Math.round(margin * 10000) / 10000,
      isAboveTarget: margin * 100 >= selectedParamSet.optimalMargin,
      optimalMargin: selectedParamSet.optimalMargin,
    };
  }, [
    selectedParamSet,
    companyMultiplier,
    watchedSupplierQuotation,
    watchedRetailPrice,
    landedCostCalc,
  ]);

  // Auto-fill buying target al cambio del retail price o del parameter set.
  // Dipendenze ridotte intenzionalmente (selectedParamSet?.id) per evitare loop.
  useEffect(() => {
    if (!watchedRetailPrice || watchedRetailPrice <= 0 || !selectedParamSet) return;
    const target = buyingTargetCalc(
      watchedRetailPrice,
      selectedParamSet,
      companyMultiplier
    );
    if (target !== null && target > 0) {
      form.setValue('buyingTargetPrice', target, { shouldDirty: false });
    }
  }, [watchedRetailPrice, selectedParamSet?.id]);

  return { selectedParamSet, marginCalc };
}
