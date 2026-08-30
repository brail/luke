/**
 * Contratto di `MandatoryReasonSchema`, il campo «di' perché» condiviso da tre endpoint.
 *
 * Il rischio specifico è l'ordine dei due passi. `.trim()` prima di `.min(1)` misura la stringa
 * ripulita; invertiti, il trim non tocca il controllo e una motivazione di soli spazi passa come
 * `''` — il form la accetta e il server la rifiuta in un toast. La differenza non si vede
 * leggendo lo schema, e finora era provata solo di rimbalzo attraverso due router, al costo di un
 * run di integrazione con database. Qui costa millisecondi, e la prossima consumatrice la eredita.
 */

import { describe, it, expect } from 'vitest';

import { MandatoryReasonSchema } from '../reason';

describe('MandatoryReasonSchema', () => {
  it('rifiuta la stringa vuota', () => {
    expect(MandatoryReasonSchema.safeParse('').success).toBe(false);
  });

  it('rifiuta una motivazione di soli spazi', () => {
    // Il caso che l'ordine sbagliato lascia passare, restituendo `''`.
    const result = MandatoryReasonSchema.safeParse('   ');
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.message).toBe('La motivazione è obbligatoria');
  });

  it('toglie gli spazi ai bordi di una motivazione valida', () => {
    const result = MandatoryReasonSchema.safeParse('  motivo  ');
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe('motivo');
  });

  it('accetta esattamente 500 caratteri e rifiuta 501', () => {
    expect(MandatoryReasonSchema.safeParse('x'.repeat(500)).success).toBe(true);
    const tooLong = MandatoryReasonSchema.safeParse('x'.repeat(501));
    expect(tooLong.success).toBe(false);
    if (!tooLong.success) expect(tooLong.error.issues[0]?.message).toBe('Massimo 500 caratteri');
  });

  it('misura la lunghezza dopo il trim, non prima', () => {
    // 500 caratteri più spazi ai bordi: con il trim in coda supererebbe il tetto.
    expect(MandatoryReasonSchema.safeParse(`  ${'x'.repeat(500)}  `).success).toBe(true);
  });
});
