/**
 * Contratto di `validatePassword`, la funzione che sta per diventare l'unica autorità sulla
 * complessità delle password su tutti i percorsi che ne impostano una.
 *
 * Oggi ha **un solo call site** (la conferma del reset) e nessun test. Prima di estenderla a
 * `users.core.create`, `users.core.update` e `me.changePassword` va fissato cosa fa davvero — in
 * particolare quali caratteri conta come speciali, che è il punto su cui diverge da tutte e sei le
 * copie client della stessa regola.
 *
 * Tier unit: la funzione è pura, la policy le arriva come argomento. Il caricamento della policy da
 * AppConfig è un'altra cosa e sta in `passwordPolicy.integration.spec.ts`.
 */

import { describe, it, expect } from 'vitest';

import { validatePassword, type PasswordPolicy } from '../src/lib/password';

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
    // Il difetto che questa fase chiude è proprio che alzare `minLength` non cambiava nulla
    // altrove: qui si fissa che la funzione la legge davvero dall'argomento.
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
      // Il senso di una policy configurabile: spegnere un requisito deve spegnerlo davvero.
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
 * La classe dei caratteri speciali è un allowlist esplicito, non «qualsiasi non alfanumerico».
 *
 * È il punto in cui il server diverge da tutte le copie client, che usano `/[^A-Za-z0-9]/`: con
 * `~`, backtick, `€` o uno spazio l'utente vede tutte le spunte verdi e si prende un rifiuto dal
 * server. La suite non poteva accorgersene perché ogni password di test contiene `!`, che
 * soddisfa entrambe le classi.
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
