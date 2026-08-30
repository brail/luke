/**
 * The contract of `validatePassword`, the single authority on password complexity across every path
 * that sets one.
 *
 * It had one call site — the reset confirmation — and no test at all. Before extending it to
 * `users.core.create`, `users.core.update` and `me.changePassword`, what it actually does had to be
 * pinned, above all which characters it counts as special: that is where it diverged from the
 * client-side copies of the same rule.
 *
 * Unit tier: the function is pure and takes its policy as an argument. Loading that policy from
 * AppConfig is a different question, covered in `passwordPolicy.integration.spec.ts`.
 */

import { describe, it, expect } from 'vitest';

import { hashPassword, validatePassword, verifyPassword, type PasswordPolicy } from '../src/lib/password';

/** Tutti i requisiti accesi: il default di `getPasswordPolicy` quando nulla è configurato. */
const STRICT: PasswordPolicy = {
  minLength: 12,
  requireUppercase: true,
  requireLowercase: true,
  requireDigit: true,
  requireSpecialChar: true,
};

const RELAXED: PasswordPolicy = {
  minLength: 8,
  requireUppercase: false,
  requireLowercase: false,
  requireDigit: false,
  requireSpecialChar: false,
};

describe('validatePassword — ogni requisito, acceso e spento', () => {
  it('accetta una password che soddisfa tutto', () => {
    expect(validatePassword('TestPassw0rd!23', STRICT)).toEqual({ isValid: true, errors: [] });
  });

  it('rifiuta sotto la lunghezza minima, citandola nel messaggio', () => {
    const result = validatePassword('Ab1!efg', STRICT);
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('Lunghezza minima: 12 caratteri');
  });

  it('la lunghezza minima è quella della policy, non una costante', () => {
    // The defect this phase closes is precisely that raising `minLength` changed nothing
    // elsewhere; this pins that the function really reads it from its argument.
    expect(validatePassword('abcdefgh', { ...RELAXED, minLength: 8 }).isValid).toBe(true);
    expect(validatePassword('abcdefgh', { ...RELAXED, minLength: 9 }).isValid).toBe(false);
  });

  const requirements: { key: keyof PasswordPolicy; missing: string; message: string }[] = [
    { key: 'requireUppercase', missing: 'testpassw0rd!23', message: 'Richiesta almeno una lettera maiuscola' },
    { key: 'requireLowercase', missing: 'TESTPASSW0RD!23', message: 'Richiesta almeno una lettera minuscola' },
    { key: 'requireDigit', missing: 'TestPassword!ab', message: 'Richiesta almeno una cifra' },
    { key: 'requireSpecialChar', missing: 'TestPassw0rd123', message: 'Richiesto almeno un carattere speciale' },
  ];

  for (const { key, missing, message } of requirements) {
    it(`con ${key} acceso rifiuta chi non lo soddisfa`, () => {
      const result = validatePassword(missing, STRICT);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain(message);
    });

    it(`con ${key} spento lo stesso input passa`, () => {
      // The point of a configurable policy: switching a requirement off must actually switch it off.
      expect(validatePassword(missing, { ...STRICT, [key]: false }).isValid).toBe(true);
    });
  }

  it('elenca tutti i requisiti mancanti, non solo il primo', () => {
    const result = validatePassword('abc', STRICT);
    expect(result.errors).toHaveLength(4); // lunghezza, maiuscola, cifra, speciale
    expect(result.isValid).toBe(false);
  });
});

/**
 * The special-character class is an explicit allowlist, not "any non-alphanumeric".
 *
 * This is where the server diverged from every client copy, which used `/[^A-Za-z0-9]/`: with `~`,
 * a backtick, `€` or a space the user saw every tick turn green and then collected a rejection from
 * the server. The suite could not notice, because every test password contains `!`, which satisfies
 * both classes.
 */
describe('validatePassword — quali caratteri contano come speciali', () => {
  const accepted = ['!', '@', '#', '$', '%', '^', '&', '*', '(', ')', '_', '+', '-', '=', '[', ']', '{', '}', ';', "'", ':', '"', '\\', '|', ',', '.', '<', '>', '/', '?'];
  const rejected = ['~', '`', '€', ' ', 'à'];

  for (const ch of accepted) {
    it(`accetta ${JSON.stringify(ch)} come carattere speciale`, () => {
      expect(validatePassword(`TestPassw0rd${ch}xy`, STRICT).isValid).toBe(true);
    });
  }

  for (const ch of rejected) {
    it(`non conta ${JSON.stringify(ch)} come carattere speciale`, () => {
      const result = validatePassword(`TestPassw0rd${ch}xy`, STRICT);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Richiesto almeno un carattere speciale');
    });
  }
});

/**
 * A stored hash that argon2 cannot read.
 *
 * `argon2.verify` throws on a malformed hash rather than returning false, so calling it directly on
 * the login path turned a corrupted credential row into a 500. `verifyPassword` swallows that and
 * answers "wrong password", which is what lets the caller report invalid credentials instead of a
 * server error. Nothing asserted it, so the claim was only a claim.
 */
describe('verifyPassword — a hash argon2 cannot read', () => {
  const malformed = ['', 'not-a-hash', '$argon2id$garbage', '$argon2id$v=19$m=65536,t=3,p=1$c2FsdA'];

  for (const hash of malformed) {
    it(`answers false instead of throwing, for ${JSON.stringify(hash.slice(0, 24))}`, async () => {
      await expect(verifyPassword('qualsiasi-password', hash)).resolves.toBe(false);
    });
  }

  it('still answers true for a real hash and the right password', async () => {
    const hash = await hashPassword('TestPassw0rd!23');
    await expect(verifyPassword('TestPassw0rd!23', hash)).resolves.toBe(true);
    await expect(verifyPassword('sbagliata', hash)).resolves.toBe(false);
  });
});
