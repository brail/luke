/**
 * Parsing contract of `CollectionAlertThresholds`, the JSON blob saved under
 * `collectionControl.alertThresholds` in AppConfig.
 *
 * The specific risk of this schema is backward compatibility: the blob lives in the database of
 * every installation, written by earlier versions of the editor. A field made mandatory, or a
 * changed default, does not break the build — it breaks the installation at the first
 * `getConfig`. These tests pin exactly that boundary.
 */

import { describe, it, expect } from 'vitest';

import { AlertBandSchema, CollectionAlertThresholdsSchema } from '../appConfig.js';

/** A band as the editor wrote it before `emphasis` existed. */
const LEGACY_BAND = {
  minDaysToDeadline: 0,
  maxDaysToDeadline: 7,
  color: '#D97706',
  label: 'Urgente',
};

describe('AlertBandSchema — emphasis', () => {
  it('a band saved before the field existed stays valid and renders as before', () => {
    const parsed = AlertBandSchema.parse(LEGACY_BAND);
    expect(parsed.emphasis).toBe('outline');
  });

  it('a value outside the three levels is rejected', () => {
    // Without this constraint the value would reach `bandBadgeStyle` intact, which would not
    // recognize it and would render an unstyled badge instead of flagging the broken configuration.
    const result = AlertBandSchema.safeParse({ ...LEGACY_BAND, emphasis: 'filled' });
    expect(result.success).toBe(false);
  });

  it('an explicit value is not overwritten by the default', () => {
    expect(AlertBandSchema.parse({ ...LEGACY_BAND, emphasis: 'solid' }).emphasis).toBe('solid');
  });
});

describe('CollectionAlertThresholdsSchema — outcome bands', () => {
  /** Full blob for the previous schema: only `default`, no outcome band. */
  const LEGACY_THRESHOLDS = { default: { bands: [LEGACY_BAND] } };

  it('a blob without outcome bands stays valid', () => {
    expect(CollectionAlertThresholdsSchema.safeParse(LEGACY_THRESHOLDS).success).toBe(true);
  });

  it('the outcome bands always have a value: `completionOutcome` reads one without being able to branch', () => {
    const parsed = CollectionAlertThresholdsSchema.parse(LEGACY_THRESHOLDS);
    expect(parsed.completedBand).toBeDefined();
    expect(parsed.completedLateBand).toBeDefined();
  });

  it('the two outcomes are distinguishable by default, both solid', () => {
    // The point of the pair is to tell at a glance whether the row closed on time: two equal
    // defaults (or not solid, like the countdown bands) would cancel the distinction.
    const { completedBand, completedLateBand } = CollectionAlertThresholdsSchema.parse(LEGACY_THRESHOLDS);
    expect(completedBand.color).not.toBe(completedLateBand.color);
    expect(completedBand.emphasis).toBe('solid');
    expect(completedLateBand.emphasis).toBe('solid');
  });

  it('outcome bands configured by the admin are not overwritten by the defaults', () => {
    const parsed = CollectionAlertThresholdsSchema.parse({
      ...LEGACY_THRESHOLDS,
      completedBand: { color: '#123456', label: 'Chiusa', emphasis: 'soft' },
    });
    expect(parsed.completedBand).toEqual({ color: '#123456', label: 'Chiusa', emphasis: 'soft' });
    // The other one stays at the default: a partial override must not reset the pair.
    expect(parsed.completedLateBand.label).toBe('Concluso in ritardo');
  });

  it('an outcome band without a colour is rejected', () => {
    const result = CollectionAlertThresholdsSchema.safeParse({
      ...LEGACY_THRESHOLDS,
      completedBand: { color: '', label: 'Chiusa' },
    });
    expect(result.success).toBe(false);
  });
});
