import type { MilestoneForSync } from '../types.js';

/**
 * Reference milestone shared by `hash.test.ts` and `engine.test.ts`.
 *
 * There must be only one: the hash sensitivity tests are worth something only if they
 * measure the same object the engine passes to Google. With two copies, a field added to
 * `MilestoneForSync` can enter one and not the other, and the suite stays green while the
 * two halves diverge.
 *
 * `visibilityFunctionIds` has two elements on purpose: `hash.test.ts` needs them to check
 * independence from order. A test that wants a single one passes it in `overrides`.
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
