import { describe, it, expect } from 'vitest';

import { computeContentHash } from '../hash.js';

import { makeMilestone } from './fixtures.js';

import type { MilestoneForSync } from '../types.js';

/**
 * `computeContentHash` decide se un evento va aggiornato su Google senza
 * interrogare Google. Un campo che influenza l'evento ma NON entra nell'hash
 * produce aggiornamenti silenziosamente saltati: l'utente modifica la milestone
 * e il calendario esterno resta indietro, senza alcun errore. Per questo ogni
 * campo rilevante ha qui un test di sensibilità dedicato.
 */
describe('computeContentHash', () => {
  it('è deterministico', () => {
    expect(computeContentHash(makeMilestone())).toBe(
      computeContentHash(makeMilestone())
    );
  });

  it('produce 32 caratteri esadecimali', () => {
    expect(computeContentHash(makeMilestone())).toMatch(/^[0-9a-f]{32}$/);
  });

  it('non dipende dall\'ordine di visibilityFunctionIds', () => {
    // Gli id arrivano da una query: l'ordine non è garantito. Se contasse,
    // ogni sync ricalcolerebbe un hash diverso e riscriverebbe l'evento su
    // Google inutilmente ad ogni giro.
    const a = computeContentHash(
      makeMilestone({ visibilityFunctionIds: ['fn-a', 'fn-b'] })
    );
    const b = computeContentHash(
      makeMilestone({ visibilityFunctionIds: ['fn-b', 'fn-a'] })
    );
    expect(a).toBe(b);
  });

  it.each([
    ['title', { title: 'Altro titolo' }],
    ['description', { description: 'Altra descrizione' }],
    ['startAt', { startAt: new Date('2099-03-02T09:00:00.000Z') }],
    ['endAt', { endAt: new Date('2099-03-01T19:00:00.000Z') }],
    ['allDay', { allDay: true }],
    ['cancelled', { cancelled: true }],
    ['visibilityFunctionIds', { visibilityFunctionIds: ['fn-a'] }],
    ['planningGroupName', { planningGroupName: 'Linea Donna' }],
  ] as [string, Partial<MilestoneForSync>][])(
    'cambia quando cambia %s',
    (_field, override) => {
      expect(computeContentHash(makeMilestone(override))).not.toBe(
        computeContentHash(makeMilestone())
      );
    }
  );

  it('distingue endAt assente da endAt valorizzato', () => {
    expect(computeContentHash(makeMilestone({ endAt: null }))).not.toBe(
      computeContentHash(makeMilestone())
    );
  });

  it('distingue description null da stringa vuota', () => {
    expect(computeContentHash(makeMilestone({ description: null }))).not.toBe(
      computeContentHash(makeMilestone({ description: '' }))
    );
  });

  it('ignora publishExternally', () => {
    // Non è un contenuto dell'evento: governa se sincronizzare o cancellare,
    // e quella decisione è dell'engine. Includerlo produrrebbe un hash diverso
    // per un evento identico.
    expect(
      computeContentHash(makeMilestone({ publishExternally: false }))
    ).toBe(computeContentHash(makeMilestone()));
  });

  it('ignora l\'id della milestone', () => {
    expect(computeContentHash(makeMilestone({ id: 'm2' }))).toBe(
      computeContentHash(makeMilestone())
    );
  });

  it('rinominare un gruppo senza cambiarne le iniziali non altera l\'hash', () => {
    // L'hash include `initials(planningGroupName)`, non il nome completo: nel
    // titolo Google finisce solo il prefisso `[LU]`. Due nomi con le stesse
    // iniziali producono un evento identico, quindi non serve riscriverlo.
    // È deliberato — l'hash misura ciò che viene renderizzato, non l'input.
    const a = computeContentHash(
      makeMilestone({ planningGroupName: 'Linea Uomo' })
    );
    const b = computeContentHash(
      makeMilestone({ planningGroupName: 'Lavorazione Ufficiale' })
    );
    expect(a).toBe(b);
  });
});
