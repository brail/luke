import { describe, it, expect } from 'vitest';

import { computeContentHash } from '../hash.js';

import { makeMilestone } from './fixtures.js';

import type { MilestoneForSync } from '../types.js';

/**
 * `computeContentHash` decides whether an event needs updating on Google without asking
 * Google. A field that affects the event but does NOT enter the hash produces silently
 * skipped updates: the user edits the milestone and the external calendar falls behind,
 * with no error at all. That is why every relevant field has a dedicated sensitivity test
 * here.
 */
describe('computeContentHash', () => {
  it('is deterministic', () => {
    expect(computeContentHash(makeMilestone())).toBe(
      computeContentHash(makeMilestone())
    );
  });

  it('produce 32 caratteri esadecimali', () => {
    expect(computeContentHash(makeMilestone())).toMatch(/^[0-9a-f]{32}$/);
  });

  it('does not depend on the order of visibilityFunctionIds', () => {
    // The ids come from a query: the order is not guaranteed. If it counted, every sync
    // would compute a different hash and rewrite the event on Google needlessly on every
    // round.
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
    'changes when %s changes',
    (_field, override) => {
      expect(computeContentHash(makeMilestone(override))).not.toBe(
        computeContentHash(makeMilestone())
      );
    }
  );

  it('tells an absent endAt apart from a set one', () => {
    expect(computeContentHash(makeMilestone({ endAt: null }))).not.toBe(
      computeContentHash(makeMilestone())
    );
  });

  it('tells a null description apart from an empty string', () => {
    expect(computeContentHash(makeMilestone({ description: null }))).not.toBe(
      computeContentHash(makeMilestone({ description: '' }))
    );
  });

  it('ignora publishExternally', () => {
    // It is not event content: it governs whether to sync or delete, and that decision
    // belongs to the engine. Including it would produce a different hash for an identical
    // event.
    expect(
      computeContentHash(makeMilestone({ publishExternally: false }))
    ).toBe(computeContentHash(makeMilestone()));
  });

  it('ignores the milestone id', () => {
    expect(computeContentHash(makeMilestone({ id: 'm2' }))).toBe(
      computeContentHash(makeMilestone())
    );
  });

  it('renaming a group without changing its initials does not alter the hash', () => {
    // The hash includes `initials(planningGroupName)`, not the full name: only the
    // `[LU]` prefix ends up in the Google title. Two names with the same initials produce
    // an identical event, so there is no need to rewrite it. It is deliberate — the hash
    // measures what is rendered, not the input.
    const a = computeContentHash(
      makeMilestone({ planningGroupName: 'Linea Uomo' })
    );
    const b = computeContentHash(
      makeMilestone({ planningGroupName: 'Lavorazione Ufficiale' })
    );
    expect(a).toBe(b);
  });
});
