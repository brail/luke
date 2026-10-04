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

import { describe, it, expect, vi } from 'vitest';

import {
  dummyPasswordHash,
  hashPassword,
  validatePassword,
  verifyPassword,
  type PasswordPolicy,
} from '../src/lib/password';

/** Every requirement on: the `getPasswordPolicy` default when nothing is configured. */
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

describe('validatePassword — every requirement, on and off', () => {
  it('accepts a password that meets everything', () => {
    expect(validatePassword('TestPassw0rd!23', STRICT)).toEqual({ isValid: true, errors: [] });
  });

  it('rejects below the minimum length, quoting it in the message', () => {
    const result = validatePassword('Ab1!efg', STRICT);
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('Lunghezza minima: 12 caratteri');
  });

  it('the minimum length is the policy one, not a constant', () => {
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
    it(`with ${key} on it rejects input that does not meet it`, () => {
      const result = validatePassword(missing, STRICT);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain(message);
    });

    it(`with ${key} off the same input passes`, () => {
      // The point of a configurable policy: switching a requirement off must actually switch it off.
      expect(validatePassword(missing, { ...STRICT, [key]: false }).isValid).toBe(true);
    });
  }

  it('lists every missing requirement, not just the first', () => {
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
describe('validatePassword — which characters count as special', () => {
  const accepted = ['!', '@', '#', '$', '%', '^', '&', '*', '(', ')', '_', '+', '-', '=', '[', ']', '{', '}', ';', "'", ':', '"', '\\', '|', ',', '.', '<', '>', '/', '?'];
  const rejected = ['~', '`', '€', ' ', 'à'];

  for (const ch of accepted) {
    it(`accepts ${JSON.stringify(ch)} as a special character`, () => {
      expect(validatePassword(`TestPassw0rd${ch}xy`, STRICT).isValid).toBe(true);
    });
  }

  for (const ch of rejected) {
    it(`does not count ${JSON.stringify(ch)} as a special character`, () => {
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

/**
 * The hash `authenticateLocal` verifies against when there is no stored one. It is only worth
 * anything if verifying against it costs what verifying a real credential costs: the same
 * algorithm and the same parameters as `hashPassword`.
 */
describe('dummyPasswordHash', () => {
  it('is an argon2id hash with the parameters real credentials use, computed once', async () => {
    const [first, second] = await Promise.all([dummyPasswordHash(), dummyPasswordHash()]);
    const real = await hashPassword('TestPassw0rd!23');

    const params = (hash: string) => hash.split('$').slice(1, 4).join('$');
    expect(params(first)).toBe(params(real));
    expect(params(first)).toBe('argon2id$v=19$m=65536,p=1,t=3');
    expect(second).toBe(first);
  });

  it('does not keep a failed hash: the next call tries again', async () => {
    // A fresh module, so nothing is memoized yet.
    vi.resetModules();
    const argon2 = (await import('argon2')).default;
    const fresh = await import('../src/lib/password');
    vi.spyOn(argon2, 'hash').mockRejectedValueOnce(new Error('out of memory'));

    await expect(fresh.dummyPasswordHash()).rejects.toThrow('out of memory');
    await expect(fresh.dummyPasswordHash()).resolves.toMatch(/^\$argon2id\$/);
  });
});
