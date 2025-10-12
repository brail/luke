/**
 * Utility per la gestione del denaro
 * Fornisce funzioni per conversione tra euro e centesimi e formattazione
 */

/**
 * Converte un importo in euro in centesimi
 *
 * @param amount - Importo in euro (es. 12.34)
 * @returns Importo in centesimi (es. 1234)
 *
 * @example
 * ```typescript
 * toCents(12.34) // 1234
 * toCents(0.99) // 99
 * toCents(100) // 10000
 * ```
 */
export function toCents(amount: number): number {
  return Math.round(amount * 100);
}

/**
 * Converte un importo in centesimi in euro
 *
 * @param cents - Importo in centesimi (es. 1234)
 * @returns Importo in euro (es. 12.34)
 *
 * @example
 * ```typescript
 * fromCents(1234) // 12.34
 * fromCents(99) // 0.99
 * fromCents(10000) // 100
 * ```
 */
export function fromCents(cents: number): number {
  return cents / 100;
}

/**
 * Formatta un importo in centesimi come stringa di valuta
 *
 * @param cents - Importo in centesimi
 * @param currency - Codice valuta (default: 'EUR')
 * @param locale - Locale per la formattazione (default: 'it-IT')
 * @returns Stringa formattata dell'importo
 *
 * @example
 * ```typescript
 * formatMoney(1234) // "12,34 €"
 * formatMoney(1234, 'USD', 'en-US') // "$12.34"
 * formatMoney(0) // "0,00 €"
 * ```
 */
export function formatMoney(
  cents: number,
  currency: string = 'EUR',
  locale: string = 'it-IT'
): string {
  try {
    const amount = fromCents(cents);

    const formatter = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

    return formatter.format(amount);
  } catch (error) {
    // Fallback semplice se il locale o la valuta non sono validi
    const amount = fromCents(cents);
    return `${amount.toFixed(2)} ${currency}`;
  }
}

/**
 * Formatta un importo in centesimi come numero con separatori
 *
 * @param cents - Importo in centesimi
 * @param locale - Locale per la formattazione (default: 'it-IT')
 * @returns Stringa formattata del numero
 *
 * @example
 * ```typescript
 * formatNumber(1234) // "12,34"
 * formatNumber(1234567) // "12.345,67"
 * ```
 */
export function formatNumber(cents: number, locale: string = 'it-IT'): string {
  try {
    const amount = fromCents(cents);

    const formatter = new Intl.NumberFormat(locale, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

    return formatter.format(amount);
  } catch (error) {
    // Fallback semplice se il locale non è valido
    const amount = fromCents(cents);
    return amount.toFixed(2);
  }
}

/**
 * Calcola la somma di un array di importi in centesimi
 *
 * @param amounts - Array di importi in centesimi
 * @returns Somma totale in centesimi
 *
 * @example
 * ```typescript
 * sumCents([100, 200, 300]) // 600
 * sumCents([]) // 0
 * ```
 */
export function sumCents(amounts: number[]): number {
  return amounts.reduce((sum, amount) => sum + amount, 0);
}

/**
 * Verifica se un importo in centesimi è valido (non negativo)
 *
 * @param cents - Importo in centesimi da verificare
 * @returns true se l'importo è valido, false altrimenti
 */
export function isValidAmount(cents: number): boolean {
  return typeof cents === 'number' && !isNaN(cents) && cents >= 0;
}
