/**
 * Invarianti del motore di calcolo prezzi.
 *
 * Le tre funzioni sono pure e non toccano il database: stanno nel tier unit.
 * Attenzione però — **queste asserzioni non muovono il gate di copertura
 * procedure**, che misura le invocazioni su `appRouter`. La copertura del router
 * `pricing` vive in `test/pricing.integration.spec.ts`.
 *
 * Nessuna di queste asserzioni è derivata leggendo l'implementazione: sono
 * relazioni che devono valere *qualunque* sia la formula, ed è la ragione per cui
 * reggono a un refactoring del calcolo. Un test che ricalcola a mano la stessa
 * catena di moltiplicazioni non direbbe nulla: fallirebbe solo se qualcuno
 * cambia la formula, cioè proprio quando è lecito farlo.
 */

import { describe, it, expect } from 'vitest';

import {
  calculateForward,
  calculateInverse,
  calculateMarginOnly,
  type CalcParams,
} from '../pricing.service';

/** Parametri realistici: gli stessi ordini di grandezza del seed. */
const PARAMS: CalcParams = {
  qualityControlPercent: 2,
  transportInsuranceCost: 3,
  duty: 8,
  exchangeRate: 1.08,
  italyAccessoryCosts: 2,
  tools: 1,
  retailMultiplier: 2.6,
  optimalMargin: 62,
  purchaseCurrency: 'CNY',
  sellingCurrency: 'EUR',
};

describe('calculateForward', () => {
  it('centra il margine aziendale dichiarato nei parametri', () => {
    const result = calculateForward(100, PARAMS);

    // È la promessa del set di parametri: `optimalMargin` non è un'aspirazione,
    // è ciò che il moltiplicatore aziendale deve produrre. Se un giorno
    // divergono, il prezzo di listino non regge più il margine promesso.
    expect(result.companyMargin * 100).toBeCloseTo(PARAMS.optimalMargin, 1);
  });

  it('il margine dipende solo da optimalMargin, non dal prezzo di acquisto', () => {
    const cheap = calculateForward(10, PARAMS);
    const expensive = calculateForward(1000, PARAMS);

    // Il margine è una proprietà del set di parametri. Se scala col prezzo,
    // qualcuno ha spostato un costo fisso dentro la parte moltiplicativa.
    expect(cheap.companyMargin).toBeCloseTo(expensive.companyMargin, 4);
  });

  it('la catena di costi è monotona: ogni step non riduce il prezzo', () => {
    const r = calculateForward(100, PARAMS);

    // Con costi e percentuali positivi nessuno step può abbassare il valore.
    // Intercetta un segno invertito in qualunque punto della catena.
    expect(r.priceWithQC).toBeGreaterThanOrEqual(r.purchasePrice);
    expect(r.priceWithTransport).toBeGreaterThanOrEqual(r.priceWithQC);
    expect(r.priceWithDuty).toBeGreaterThanOrEqual(r.priceWithTransport);
    expect(r.wholesalePrice).toBeGreaterThan(r.landedCost);
    expect(r.retailPrice).toBeGreaterThan(r.wholesalePrice);
  });

  it('un prezzo di acquisto più alto produce un retail più alto', () => {
    // Monotonia rispetto all'input: banale da verificare, e l'unica cosa che
    // distingue un motore di prezzi da un generatore di numeri.
    expect(calculateForward(200, PARAMS).retailPriceRaw).toBeGreaterThan(
      calculateForward(100, PARAMS).retailPriceRaw
    );
  });
});

describe('calculateInverse', () => {
  it('è l’inversa di calculateForward', () => {
    const purchasePrice = 137.5;
    const forward = calculateForward(purchasePrice, PARAMS);

    // Si parte da `retailPriceRaw` e non da `retailPrice`: quest'ultimo è
    // arrotondato a prezzo psicologico, quindi il giro non potrebbe chiudere
    // esattamente. L'invariante riguarda la catena di calcolo, non
    // l'arrotondamento commerciale.
    const back = calculateInverse(forward.retailPriceRaw, PARAMS);

    expect(back.purchasePriceRaw).toBeCloseTo(purchasePrice, 1);
  });

  it('ricostruisce gli stessi valori intermedi del forward', () => {
    const forward = calculateForward(137.5, PARAMS);
    const back = calculateInverse(forward.retailPriceRaw, PARAMS);

    expect(back.wholesalePrice).toBeCloseTo(forward.wholesalePrice, 1);
    expect(back.landedCost).toBeCloseTo(forward.landedCost, 1);
    expect(back.companyMargin).toBeCloseTo(forward.companyMargin, 3);
  });

  it('arrotonda il prezzo di acquisto per difetto', () => {
    const back = calculateInverse(1000, PARAMS);

    // Arrotondare per eccesso il prezzo massimo pagabile eroderebbe il margine:
    // la direzione dell'arrotondamento è una scelta commerciale, non un
    // dettaglio numerico.
    expect(back.purchasePrice).toBeLessThanOrEqual(back.purchasePriceRaw);
  });
});

describe('calculateMarginOnly', () => {
  it('conferma il margine dichiarato quando i prezzi vengono dal forward', () => {
    const forward = calculateForward(100, PARAMS);
    const margin = calculateMarginOnly(100, forward.retailPriceRaw, PARAMS);

    // Le tre modalità devono raccontare la stessa storia sugli stessi numeri.
    expect(margin.companyMargin).toBeCloseTo(forward.companyMargin, 3);
    expect(margin.landedCost).toBeCloseTo(forward.landedCost, 1);
  });

  it('un retail più basso a parità di costo comprime il margine', () => {
    const full = calculateMarginOnly(100, 800, PARAMS);
    const discounted = calculateMarginOnly(100, 600, PARAMS);

    expect(discounted.companyMargin).toBeLessThan(full.companyMargin);
  });

  it('segnala margine negativo quando il retail non copre il costo', () => {
    // Caso limite che conta davvero: vendere sotto costo deve produrre un
    // numero negativo, non un errore né uno zero silenzioso.
    const result = calculateMarginOnly(100, 150, PARAMS);

    expect(result.companyMargin).toBeLessThan(0);
  });
});
