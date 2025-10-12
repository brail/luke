/**
 * Modulo per il calcolo dei prezzi
 * Gestisce la logica di pricing con margini e costi base
 */

/**
 * Parametri per il calcolo del prezzo
 */
export interface PricingParams {
  /** Costo base del prodotto/servizio */
  costoBase: number;

  /** Margine percentuale da applicare (es. 0.20 = 20%) */
  margine: number;
}

/**
 * Risultato del calcolo del prezzo
 */
export interface PricingResult {
  /** Prezzo di acquisto (uguale al costo base) */
  prezzoAcquisto: number;

  /** Prezzo di vendita (costo base + margine) */
  prezzoVendita: number;

  /** Margine assoluto in euro */
  margineAssoluto: number;

  /** Margine percentuale applicato */
  marginePercentuale: number;
}

/**
 * Calcola il prezzo di vendita basato su costo base e margine
 *
 * @param params - Parametri per il calcolo del prezzo
 * @returns Risultato con prezzo di acquisto e vendita
 *
 * @example
 * ```typescript
 * const result = calcPrice({ costoBase: 100, margine: 0.20 });
 * // result = { prezzoAcquisto: 100, prezzoVendita: 120, margineAssoluto: 20, marginePercentuale: 0.20 }
 * ```
 */
export function calcPrice(params: PricingParams): PricingResult {
  const { costoBase, margine } = params;

  // Validazione input
  if (costoBase < 0) {
    throw new Error('Il costo base non può essere negativo');
  }

  if (margine < 0) {
    throw new Error('Il margine non può essere negativo');
  }

  const prezzoAcquisto = costoBase;
  const prezzoVendita = costoBase * (1 + margine);
  const margineAssoluto = prezzoVendita - prezzoAcquisto;

  return {
    prezzoAcquisto,
    prezzoVendita,
    margineAssoluto,
    marginePercentuale: margine,
  };
}

/**
 * Calcola il margine percentuale basato su costo e prezzo di vendita
 *
 * @param costoBase - Costo base del prodotto
 * @param prezzoVendita - Prezzo di vendita finale
 * @returns Margine percentuale (es. 0.20 = 20%)
 *
 * @example
 * ```typescript
 * const margine = calcMargine(100, 120); // 0.20 (20%)
 * ```
 */
export function calcMargine(costoBase: number, prezzoVendita: number): number {
  if (costoBase <= 0) {
    throw new Error('Il costo base deve essere maggiore di zero');
  }

  if (prezzoVendita < costoBase) {
    throw new Error(
      'Il prezzo di vendita non può essere inferiore al costo base'
    );
  }

  return (prezzoVendita - costoBase) / costoBase;
}

/**
 * Calcola il prezzo di vendita per ottenere un margine target
 *
 * @param costoBase - Costo base del prodotto
 * @param margineTarget - Margine percentuale desiderato
 * @returns Prezzo di vendita necessario
 *
 * @example
 * ```typescript
 * const prezzo = calcPrezzoPerMargine(100, 0.25); // 125
 * ```
 */
export function calcPrezzoPerMargine(
  costoBase: number,
  margineTarget: number
): number {
  if (costoBase < 0) {
    throw new Error('Il costo base non può essere negativo');
  }

  if (margineTarget < 0) {
    throw new Error('Il margine target non può essere negativo');
  }

  return costoBase * (1 + margineTarget);
}

/**
 * Applica uno sconto percentuale a un prezzo
 *
 * @param prezzo - Prezzo originale
 * @param scontoPercentuale - Sconto da applicare (es. 0.10 = 10%)
 * @returns Prezzo scontato
 *
 * @example
 * ```typescript
 * const prezzoScontato = applicaSconto(100, 0.15); // 85
 * ```
 */
export function applicaSconto(
  prezzo: number,
  scontoPercentuale: number
): number {
  if (prezzo < 0) {
    throw new Error('Il prezzo non può essere negativo');
  }

  if (scontoPercentuale < 0 || scontoPercentuale > 1) {
    throw new Error('Lo sconto deve essere tra 0 e 1 (0% - 100%)');
  }

  return prezzo * (1 - scontoPercentuale);
}

/**
 * Verifica se i parametri di pricing sono validi
 *
 * @param params - Parametri da validare
 * @returns true se i parametri sono validi, false altrimenti
 */
export function isValidPricingParams(params: PricingParams): boolean {
  return (
    typeof params.costoBase === 'number' &&
    typeof params.margine === 'number' &&
    params.costoBase >= 0 &&
    params.margine >= 0 &&
    !isNaN(params.costoBase) &&
    !isNaN(params.margine)
  );
}
