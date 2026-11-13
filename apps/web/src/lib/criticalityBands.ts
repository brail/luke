import type { AlertBandEmphasis, CollectionAlertThresholds } from '@luke/core';

/**
 * The filter's "no criticality" choice: a row the alert engine gives no band (no phase, or no
 * planned event for it). Empty, since a band's label never is: no band can collide with it.
 */
export const NO_CRITICALITY = '';

export interface CriticalityBandOption {
  label: string;
  color: string;
  emphasis: AlertBandEmphasis;
}

/**
 * The bands the criticality filter offers (#53), by name: a band has no id and its badge shows the
 * name, so two bands that share it are one choice. The default bands in order, then the per-phase
 * override bands with a new name, then the two completion outcomes.
 */
export function criticalityBandOptions(thresholds: CollectionAlertThresholds): CriticalityBandOption[] {
  const bands = [
    ...thresholds.default.bands,
    ...Object.values(thresholds.perPhaseOverride ?? {}).flatMap(set => set.bands),
    thresholds.completedBand,
    thresholds.completedLateBand,
  ];
  const byLabel = new Map<string, CriticalityBandOption>();
  for (const { label, color, emphasis } of bands) if (!byLabel.has(label)) byLabel.set(label, { label, color, emphasis });
  return [...byLabel.values()];
}

/** No band chosen lets every row through; otherwise the row's band name, or `NO_CRITICALITY`, must be chosen. */
export function matchesCriticality(chosen: readonly string[], bandLabel: string | undefined): boolean {
  return chosen.length === 0 || chosen.includes(bandLabel ?? NO_CRITICALITY);
}
