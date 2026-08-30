/**
 * Contratto di `evaluatePassword`: quello che l'utente vede chiedere deve essere quello che il
 * server chiede davvero.
 *
 * La versione precedente aveva cinque controlli e cinque messaggi scritti a mano: diceva 12
 * caratteri e «un simbolo» qualunque cosa l'installazione avesse configurato. Questi test fissano
 * la proprietà che rende utile la configurazione — cambiare la policy cambia sia il verdetto sia
 * ciò che viene mostrato — e la classe di caratteri, che è dove client e server divergevano.
 */

import { describe, expect, it } from 'vitest';

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
    // È la differenza fra «configurabile» e «configurabile solo verso il più severo»: un requisito
    // tolto non deve restare a schermo come una spunta che non si accenderà mai.
    expect(keys({ ...FALLBACK_PASSWORD_POLICY, requireDigit: false })).not.toContain('digit');
    expect(keys(RELAXED)).toEqual(['length']);
  });

  it('la lunghezza mostrata è quella configurata, non una costante', () => {
    const [check] = evaluatePassword('', undefined, { ...FALLBACK_PASSWORD_POLICY, minLength: 16 }).checks;
    expect(check?.label).toBe('Almeno 16 caratteri');
  });

  it('il requisito sui simboli nomina i caratteri ammessi', () => {
    // «Un simbolo» è ciò che lasciava sembrare accettabili `~` e lo spazio fino al rifiuto.
    const special = evaluatePassword('', undefined, FALLBACK_PASSWORD_POLICY).checks.find(c => c.key === 'special');
    expect(special?.label).toContain(FALLBACK_PASSWORD_POLICY.specialChars);
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
  it('una password vuota è valida e non elenca errori: in edit vuol dire «lascia quella che c’è»', () => {
    const result = evaluatePassword('', '', FALLBACK_PASSWORD_POLICY);
    expect(result.isValid).toBe(true);
    expect(result.errors).toEqual([]);
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
