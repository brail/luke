/**
 * Contratto di parsing di `CollectionAlertThresholds`, il blob JSON salvato sotto
 * `collectionControl.alertThresholds` in AppConfig.
 *
 * Il rischio specifico di questo schema è la retrocompatibilità: il blob vive nel database di
 * ogni installazione, scritto da versioni precedenti dell'editor. Un campo reso obbligatorio, o
 * un default cambiato, non rompe la compilazione — rompe l'installazione al primo `getConfig`.
 * Questi test fissano proprio quel confine.
 */

import { describe, it, expect } from 'vitest';

import { AlertBandSchema, CollectionAlertThresholdsSchema } from '../appConfig.js';

/** Banda come la scriveva l'editor prima che `emphasis` esistesse. */
const LEGACY_BAND = {
  minDaysToDeadline: 0,
  maxDaysToDeadline: 7,
  color: '#D97706',
  label: 'Urgente',
};

describe('AlertBandSchema — emphasis', () => {
  it('una banda salvata prima che il campo esistesse resta valida e rende come prima', () => {
    const parsed = AlertBandSchema.parse(LEGACY_BAND);
    expect(parsed.emphasis).toBe('outline');
  });

  it('un valore fuori dai tre livelli è rifiutato', () => {
    // Senza questo vincolo il valore arriverebbe intatto a `bandBadgeStyle`, che non lo
    // riconoscerebbe e renderebbe un badge senza stile invece di segnalare la configurazione rotta.
    const result = AlertBandSchema.safeParse({ ...LEGACY_BAND, emphasis: 'filled' });
    expect(result.success).toBe(false);
  });

  it('un valore esplicito non viene sovrascritto dal default', () => {
    expect(AlertBandSchema.parse({ ...LEGACY_BAND, emphasis: 'solid' }).emphasis).toBe('solid');
  });
});

describe('CollectionAlertThresholdsSchema — bande di esito', () => {
  /** Blob completo per lo schema precedente: solo `default`, nessuna banda di esito. */
  const LEGACY_THRESHOLDS = { default: { bands: [LEGACY_BAND] } };

  it('un blob senza bande di esito resta valido', () => {
    expect(CollectionAlertThresholdsSchema.safeParse(LEGACY_THRESHOLDS).success).toBe(true);
  });

  it('le bande di esito hanno sempre un valore: `completionOutcome` ne legge una senza poter ramificare', () => {
    const parsed = CollectionAlertThresholdsSchema.parse(LEGACY_THRESHOLDS);
    expect(parsed.completedBand).toBeDefined();
    expect(parsed.completedLateBand).toBeDefined();
  });

  it('i due esiti sono distinguibili di default, entrambi pieni', () => {
    // Il senso della coppia è dire a colpo d'occhio se la riga ha chiuso in tempo: due default
    // uguali (o non pieni, come le bande di countdown) annullerebbero la distinzione.
    const { completedBand, completedLateBand } = CollectionAlertThresholdsSchema.parse(LEGACY_THRESHOLDS);
    expect(completedBand.color).not.toBe(completedLateBand.color);
    expect(completedBand.emphasis).toBe('solid');
    expect(completedLateBand.emphasis).toBe('solid');
  });

  it('bande di esito configurate dall\'admin non vengono sovrascritte dai default', () => {
    const parsed = CollectionAlertThresholdsSchema.parse({
      ...LEGACY_THRESHOLDS,
      completedBand: { color: '#123456', label: 'Chiusa', emphasis: 'soft' },
    });
    expect(parsed.completedBand).toEqual({ color: '#123456', label: 'Chiusa', emphasis: 'soft' });
    // L'altra resta al default: un override parziale non deve azzerare la coppia.
    expect(parsed.completedLateBand.label).toBe('Concluso in ritardo');
  });

  it('una banda di esito senza colore è rifiutata', () => {
    const result = CollectionAlertThresholdsSchema.safeParse({
      ...LEGACY_THRESHOLDS,
      completedBand: { color: '', label: 'Chiusa' },
    });
    expect(result.success).toBe(false);
  });
});
