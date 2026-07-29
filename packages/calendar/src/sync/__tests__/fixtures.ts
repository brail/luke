import type { MilestoneForSync } from '../types.js';

/**
 * Milestone di riferimento condivisa da `hash.test.ts` e `engine.test.ts`.
 *
 * Deve restare una sola: i test di sensibilità dell'hash valgono qualcosa solo
 * se misurano lo stesso oggetto che l'engine passa a Google. Con due copie, un
 * campo aggiunto a `MilestoneForSync` può entrare in una e non nell'altra, e la
 * suite resta verde mentre le due metà divergono.
 *
 * `visibilityFunctionIds` ha due elementi di proposito: serve a `hash.test.ts`
 * per verificare l'indipendenza dall'ordine. Chi ne vuole una sola la passa in
 * `overrides`.
 */
export function makeMilestone(
  overrides: Partial<MilestoneForSync> = {}
): MilestoneForSync {
  return {
    id: 'm1',
    title: 'Consegna campionario',
    description: 'Descrizione',
    startAt: new Date('2099-03-01T09:00:00.000Z'),
    endAt: new Date('2099-03-01T18:00:00.000Z'),
    allDay: false,
    cancelled: false,
    publishExternally: true,
    visibilityFunctionIds: ['fn-a', 'fn-b'],
    planningGroupName: 'Linea Uomo',
    ...overrides,
  };
}
