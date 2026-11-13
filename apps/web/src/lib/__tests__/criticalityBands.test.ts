/**
 * The collection layout's criticality filter (#53) offers the configured bands by name, once each,
 * and keeps a row whose band (or lack of one) is chosen.
 */

import { describe, expect, it } from 'vitest';

import type { CollectionAlertThresholds } from '@luke/core';

import { criticalityBandOptions, matchesCriticality, NO_CRITICALITY } from '../criticalityBands';


const band = (label: string, color = '#000000') => ({ minDaysToDeadline: 0, maxDaysToDeadline: null, color, label, emphasis: 'outline' as const });

const thresholds: CollectionAlertThresholds = {
  default: { bands: [band('In ritardo'), band('Urgente'), band('In linea')] },
  perPhaseOverride: { PROTO: { bands: [band('Urgente', '#FF0000'), band('Critico')] } },
  completedBand: { label: 'Concluso', color: '#15803D', emphasis: 'solid' },
  completedLateBand: { label: 'Concluso in ritardo', color: '#B91C1C', emphasis: 'solid' },
};

describe('criticalityBandOptions', () => {
  it('lists the default bands, then the override bands with a new name, then the outcomes, once each', () => {
    expect(criticalityBandOptions(thresholds).map(o => o.label))
      .toEqual(['In ritardo', 'Urgente', 'In linea', 'Critico', 'Concluso', 'Concluso in ritardo']);
    // A shared name keeps the first band's look.
    expect(criticalityBandOptions(thresholds)[1].color).toBe('#000000');
  });
});

describe('matchesCriticality', () => {
  it('keeps every row with no band chosen', () => {
    expect(matchesCriticality([], undefined)).toBe(true);
    expect(matchesCriticality([], 'Urgente')).toBe(true);
  });

  it('keeps a row whose band is chosen, or with no band when that is chosen', () => {
    expect(matchesCriticality(['Urgente', 'Concluso'], 'Urgente')).toBe(true);
    expect(matchesCriticality(['Urgente'], 'In linea')).toBe(false);
    expect(matchesCriticality(['Urgente'], undefined)).toBe(false);
    expect(matchesCriticality([NO_CRITICALITY], undefined)).toBe(true);
  });
});
