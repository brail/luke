/**
 * The contract of `MandatoryReasonSchema`, the "say why" field shared by three endpoints.
 *
 * The specific risk is the order of the two steps. `.trim()` before `.min(1)` measures the cleaned
 * string; reversed, the trim does not touch the check and a whitespace-only reason passes as `''` —
 * the form accepts it and the server refuses it in a toast. The difference is invisible when reading
 * the schema, and until now was only proved indirectly through two routers, at the cost of a full
 * database run. Here it costs milliseconds, and the next consumer inherits it.
 */

import { describe, it, expect } from 'vitest';

import { MandatoryReasonSchema } from '../reason.js';

describe('MandatoryReasonSchema', () => {
  it('rifiuta la stringa vuota', () => {
    expect(MandatoryReasonSchema.safeParse('').success).toBe(false);
  });

  it('rifiuta una motivazione di soli spazi', () => {
    // The case the wrong order lets through, returning `''`.
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
    // 500 characters plus surrounding spaces: with the trim last, this would exceed the cap.
    expect(MandatoryReasonSchema.safeParse(`  ${'x'.repeat(500)}  `).success).toBe(true);
  });
});
