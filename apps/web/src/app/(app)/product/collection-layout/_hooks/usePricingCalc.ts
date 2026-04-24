'use client';

import { useCallback, useEffect, useMemo } from 'react';

import type { RouterOutputs } from '@luke/api';
import { calcMaxSupplierCost, roundRetailPrice, type CollectionLayoutRowInput } from '@luke/core';

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
  marginStatus: 'green' | 'yellow' | 'red';
  optimalMargin: number;
  targetRetailPrice: number;
  targetSupplierCost: number;
  currentRetailPrice: number;
  currentSupplierCost: number;
}

// ─── Pure helpers (usable outside hook context) ───────────────────────────────

export interface MarginComputeInput {
  pricingParameterSetId?: string | null;
  supplierFirstQuotation?: number | null;
  retailTargetPrice?: number | null;
  qtyForecast: number;
}

/** Compute theoretical margin for a single row. Returns null when data is incomplete. */
function computeMarginStatus(
  marginPct: number,
  optimalMargin: number
): 'green' | 'yellow' | 'red' {
  if (marginPct >= optimalMargin) return 'green';
  if (marginPct >= optimalMargin - 3) return 'yellow';
  return 'red';
}

export function computeRowMargin(
  row: MarginComputeInput,
  parameterSets: PricingParameterSet[]
): { margin: number; isAboveTarget: boolean; marginStatus: 'green' | 'yellow' | 'red' } | null {
  if (!row.pricingParameterSetId || !row.supplierFirstQuotation || !row.retailTargetPrice) return null;
  if (row.supplierFirstQuotation <= 0 || row.retailTargetPrice <= 0) return null;
  const ps = parameterSets.find(p => p.id === row.pricingParameterSetId);
  if (!ps) return null;

  const qc = row.supplierFirstQuotation * (ps.qualityControlPercent / 100);
  const withQC = row.supplierFirstQuotation + qc + ps.tools;
  const withTransport = withQC + ps.transportInsuranceCost;
  const withDuty = withTransport * (1 + ps.duty / 100);
  const landed = withDuty / ps.exchangeRate + ps.italyAccessoryCosts;

  const wholesale = row.retailTargetPrice / ps.retailMultiplier;
  const margin = (wholesale - landed) / wholesale;
  const marginStatus = computeMarginStatus(margin * 100, ps.optimalMargin);

  return {
    margin: Math.round(margin * 10000) / 10000,
    isAboveTarget: marginStatus === 'green',
    marginStatus,
  };
}

/** Compute qty-weighted average margin across rows. Returns null if no row has margin data. */
export function computeWeightedMargin(
  rows: MarginComputeInput[],
  parameterSets: PricingParameterSet[]
): number | null {
  let totalQty = 0;
  let weightedSum = 0;
  for (const row of rows) {
    const m = computeRowMargin(row, parameterSets);
    if (!m) continue;
    weightedSum += m.margin * row.qtyForecast;
    totalQty += row.qtyForecast;
  }
  return totalQty > 0 ? Math.round((weightedSum / totalQty) * 10000) / 10000 : null;
}

// ─────────────────────────────────────────────────────────────────────────────

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

  const marginCalc = useMemo((): MarginCalc | null => {
    if (
      !selectedParamSet ||
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
    const marginStatus = computeMarginStatus(margin * 100, selectedParamSet.optimalMargin);
    const wholesaleTarget = landed / (1 - selectedParamSet.optimalMargin / 100);
    const targetRetailPrice = roundRetailPrice(wholesaleTarget * selectedParamSet.retailMultiplier);
    const targetSupplierCost = calcMaxSupplierCost(watchedRetailPrice, selectedParamSet);
    return {
      landedCost: Math.round(landed * 100) / 100,
      wholesalePrice: Math.round(wholesale * 100) / 100,
      companyMargin: Math.round(margin * 10000) / 10000,
      isAboveTarget: marginStatus === 'green',
      marginStatus,
      optimalMargin: selectedParamSet.optimalMargin,
      targetRetailPrice,
      targetSupplierCost,
      currentRetailPrice: watchedRetailPrice,
      currentSupplierCost: watchedSupplierQuotation,
    };
  }, [selectedParamSet, watchedSupplierQuotation, watchedRetailPrice, landedCostCalc]);

  // Auto-fill buying target al cambio del retail price o del parameter set.
  // Dipendenze ridotte intenzionalmente (selectedParamSet?.id) per evitare loop.
  useEffect(() => {
    if (!watchedRetailPrice || watchedRetailPrice <= 0 || !selectedParamSet) return;
    const target = calcMaxSupplierCost(watchedRetailPrice, selectedParamSet);
    if (target > 0) {
      form.setValue('buyingTargetPrice', target, { shouldDirty: false });
    }
  }, [watchedRetailPrice, selectedParamSet?.id]);

  return { selectedParamSet, marginCalc };
}
