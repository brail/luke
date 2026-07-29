/**
 * Chiave localStorage che marca il saluto giornaliero come già visto.
 *
 * Vive in un modulo senza dipendenze — niente `'use client'`, niente tRPC — così
 * può essere importata sia dall'hook che dal processo Playwright, che deve
 * sopprimere il modale prima che intercetti i click. Duplicarne il formato da
 * qualche altra parte significherebbe che al primo cambio (prefisso, fuso,
 * versione) la soppressione smette di funzionare in silenzio e ogni smoke
 * fallisce su un click bloccato da un `Dialog` a schermo intero.
 */
export function dailyGreetingSeenKey(date: Date = new Date()): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `luke-greeting-seen-${yyyy}-${mm}-${dd}`;
}
