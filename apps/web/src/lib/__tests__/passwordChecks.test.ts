/**
 * The contract of `evaluatePassword`: what the user is shown must be what the server asks for.
 *
 * The previous version had five hand-written checks and five hand-written messages, saying twelve
 * characters and "a symbol" whatever the installation had configured. These tests pin the property
 * that makes the configuration worth having — changing the policy changes both the verdict and what
 * is displayed — and the character class, which is where client and server diverged.
 */

import { describe, expect, it } from 'vitest';

import { PASSWORD_SPECIAL_CHARS } from '@luke/core';

import {
  FALLBACK_PASSWORD_POLICY,
  evaluatePassword,
  type ClientPasswordPolicy,
} from '../passwordChecks';

const RELAXED: ClientPasswordPolicy = {
  ...FALLBACK_PASSWORD_POLICY,
  minLength: 8,
  requireUppercase: false,
  requireLowercase: false,
  requireDigit: false,
  requireSpecialChar: false,
};

const keys = (policy: ClientPasswordPolicy, password = '') =>
  evaluatePassword(password, undefined, policy).checks.map(c => c.key);

describe('i requisiti mostrati vengono dalla policy', () => {
  it('con tutto acceso li elenca tutti', () => {
    expect(keys(FALLBACK_PASSWORD_POLICY)).toEqual(['length', 'uppercase', 'lowercase', 'digit', 'special']);
  });

  it('un requisito spento sparisce dall’elenco invece di restare non soddisfatto', () => {
    // The difference between "configurable" and "configurable only towards stricter": a removed
    // requirement must not stay on screen as a tick that will never turn green.
    expect(keys({ ...FALLBACK_PASSWORD_POLICY, requireDigit: false })).not.toContain('digit');
    expect(keys(RELAXED)).toEqual(['length']);
  });

  it('la lunghezza mostrata è quella configurata, non una costante', () => {
    const [check] = evaluatePassword('', undefined, { ...FALLBACK_PASSWORD_POLICY, minLength: 16 }).checks;
    expect(check?.label).toBe('Almeno 16 caratteri');
  });

  it('il requisito sui simboli nomina i caratteri ammessi', () => {
    // "A symbol" is what made `~` and a space look acceptable right up to the rejection.
    const special = evaluatePassword('', undefined, FALLBACK_PASSWORD_POLICY).checks.find(c => c.key === 'special');
    expect(special?.label).toContain(PASSWORD_SPECIAL_CHARS);
  });

  it('il fallback usa la classe del server, non una copia', () => {
    // Comparing it against itself proved nothing: dropping three characters from the client copy
    // left the suite green while the server went on accepting them.
    expect(FALLBACK_PASSWORD_POLICY.specialChars).toBe(PASSWORD_SPECIAL_CHARS);
  });
});

describe('il verdetto segue la policy', () => {
  it('rifiuta sotto la lunghezza configurata e accetta sopra', () => {
    const policy = { ...FALLBACK_PASSWORD_POLICY, minLength: 16 };
    expect(evaluatePassword('TestPassw0rd!x', undefined, policy).isValid).toBe(false);
    expect(evaluatePassword('TestPassw0rd!xyz', undefined, policy).isValid).toBe(true);
  });

  it('spegnere un requisito rende valida la stessa password', () => {
    const noUpper = 'passw0rd!123';
    expect(evaluatePassword(noUpper, undefined, FALLBACK_PASSWORD_POLICY).isValid).toBe(false);
    expect(
      evaluatePassword(noUpper, undefined, { ...FALLBACK_PASSWORD_POLICY, requireUppercase: false }).isValid
    ).toBe(true);
  });
});

describe('quali caratteri contano come speciali', () => {
  const withChar = (ch: string) =>
    evaluatePassword(`TestPassw0rd${ch}x`, undefined, FALLBACK_PASSWORD_POLICY).isValid;

  for (const ch of ['!', '@', '#', '\\', '|', '?']) {
    it(`accetta ${JSON.stringify(ch)}`, () => expect(withChar(ch)).toBe(true));
  }

  for (const ch of ['~', '`', '€', ' ']) {
    it(`non accetta ${JSON.stringify(ch)}, come il server`, () => expect(withChar(ch)).toBe(false));
  }
});

describe('password vuota e conferma', () => {
  it('una password vuota non è valida e dice cosa manca', () => {
    // There used to be an exemption here, justified as "in edit mode it means keep the existing
    // one". But that meaning belongs to `EditUserSchema` and `buildUserPayload`, not to this
    // function: the only consumer of the verdict is the reset page, where empty is not valid.
    const result = evaluatePassword('', '', FALLBACK_PASSWORD_POLICY);
    expect(result.isValid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('quando non è valida c’è sempre qualcosa da mostrare', () => {
    // The missing invariant: `errors` skipped the match check while `isValid` counted it, so the
    // reset page rendered "Password non valida: " and nothing else.
    const result = evaluatePassword('TestPassw0rd!x', '', FALLBACK_PASSWORD_POLICY);
    expect(result.isValid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('segnala le password che non coincidono', () => {
    const result = evaluatePassword('TestPassw0rd!x', 'altro', FALLBACK_PASSWORD_POLICY);
    expect(result.confirmError).toBe('Le password non coincidono');
    expect(result.isValid).toBe(false);
  });

  it('senza campo di conferma non aggiunge il controllo di corrispondenza', () => {
    expect(keys(FALLBACK_PASSWORD_POLICY)).not.toContain('match');
  });
});
