import { describe, it, expect, beforeEach, vi } from 'vitest';

// `vi.mock` is hoisted above the imports: the mocks are already active when
// `engine.js` loads, so the static import is safe.
import { syncMilestone } from '../engine.js';
import { computeContentHash } from '../hash.js';

import { makeMilestone as makeSharedMilestone } from './fixtures.js';

import type {
  GoogleEventMappingRecord,
  MilestoneForSync,
  SyncContext,
} from '../types.js';

/**
 * `syncMilestone` is the only place that decides what happens on the Google calendars.
 * Every wrong branch is invisible on the Luke side and visible only to end users: an event
 * that does not disappear when it should, or that reappears where it must not.
 */
const google = vi.hoisted(() => ({
  createEvent: vi.fn(),
  updateEvent: vi.fn(),
  deleteEvent: vi.fn(),
}));

vi.mock('../../google/events.js', () => ({
  createEvent: google.createEvent,
  updateEvent: google.updateEvent,
  deleteEvent: google.deleteEvent,
}));

/**
 * Milestone visible to **a single** function.
 *
 * `syncMilestone` fans out per function: with the shared fixture, which has two, every
 * count of Google calls would double and the tests on the individual branches would
 * measure the fan-out instead of the branch. A test that wants the fan-out asks for it
 * explicitly, as the dedicated test does.
 */
function makeMilestone(
  overrides: Partial<MilestoneForSync> = {}
): MilestoneForSync {
  return makeSharedMilestone({ visibilityFunctionIds: ['fn-a'], ...overrides });
}

function makeMapping(
  overrides: Partial<GoogleEventMappingRecord> = {}
): GoogleEventMappingRecord {
  return {
    eventId: 'm1',
    companyFunctionId: 'fn-a',
    googleEventId: 'gev-1',
    googleCalendarId: 'gcal-1',
    contentHash: 'hash-vecchio',
    lastSyncedAt: new Date(),
    ...overrides,
  };
}

function makeContext(mappings: GoogleEventMappingRecord[] = []): SyncContext {
  return {
    seasonCalendarId: 'sc-1',
    brandCode: 'ACME',
    seasonCode: 'FW25',
    getOrCreateBinding: vi.fn(async (companyFunctionId: string) => ({
      id: `bind-${companyFunctionId}`,
      seasonCalendarId: 'sc-1',
      companyFunctionId,
      googleCalendarId: `gcal-${companyFunctionId}`,
      isProvisioned: true,
    })),
    getMappings: vi.fn(async () => mappings),
    upsertMapping: vi.fn(async () => {}),
    deleteMapping: vi.fn(async () => {}),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  google.createEvent.mockResolvedValue('gev-nuovo');
  google.updateEvent.mockResolvedValue(undefined);
  google.deleteEvent.mockResolvedValue(undefined);
});

describe('syncMilestone — creation', () => {
  it('creates the event and saves the mapping when none exists', async () => {
    const ctx = makeContext();
    const milestone = makeMilestone();

    // `true`: Google was called, so the caller records a success (#223).
    expect(await syncMilestone(milestone, ctx)).toBe(true);

    expect(google.createEvent).toHaveBeenCalledTimes(1);
    expect(google.createEvent).toHaveBeenCalledWith('gcal-fn-a', {
      title: '[LU] Consegna campionario',
      description: 'Descrizione',
      startAt: milestone.startAt,
      endAt: milestone.endAt,
      allDay: false,
      status: 'confirmed',
    });

    expect(ctx.upsertMapping).toHaveBeenCalledWith({
      eventId: 'm1',
      companyFunctionId: 'fn-a',
      googleEventId: 'gev-nuovo',
      googleCalendarId: 'gcal-fn-a',
      contentHash: computeContentHash(milestone),
    });
  });

  it('creates an event for every visible function', async () => {
    const ctx = makeContext();

    await syncMilestone(
      makeMilestone({ visibilityFunctionIds: ['fn-a', 'fn-b'] }),
      ctx
    );

    expect(google.createEvent).toHaveBeenCalledTimes(2);
    expect(ctx.upsertMapping).toHaveBeenCalledTimes(2);
  });

  it('maps cancelled onto the Google status', async () => {
    await syncMilestone(makeMilestone({ cancelled: true }), makeContext());

    expect(google.createEvent).toHaveBeenCalledWith(
      'gcal-fn-a',
      expect.objectContaining({ status: 'cancelled' })
    );
  });
});

describe('syncMilestone — update and skip', () => {
  it('skips when the hash matches', async () => {
    const milestone = makeMilestone();
    const ctx = makeContext([
      makeMapping({ contentHash: computeContentHash(milestone) }),
    ]);

    // `false`: nothing reached Google, so nothing is recorded as a success.
    expect(await syncMilestone(milestone, ctx)).toBe(false);

    // The very point of the hash: no Google call for an unchanged event. If this test
    // breaks, every sync rewrites everything.
    expect(google.createEvent).not.toHaveBeenCalled();
    expect(google.updateEvent).not.toHaveBeenCalled();
    expect(ctx.upsertMapping).not.toHaveBeenCalled();
  });

  it('updates in place when the hash differs', async () => {
    const milestone = makeMilestone();
    const ctx = makeContext([makeMapping({ contentHash: 'obsoleto' })]);

    expect(await syncMilestone(milestone, ctx)).toBe(true);

    expect(google.updateEvent).toHaveBeenCalledWith(
      'gcal-1',
      'gev-1',
      expect.objectContaining({ title: '[LU] Consegna campionario' })
    );
    // Reuses the existing event instead of creating another one: creating a second
    // event would leave an orphan duplicate on the user's calendar.
    expect(google.createEvent).not.toHaveBeenCalled();
    expect(ctx.upsertMapping).toHaveBeenCalledWith(
      expect.objectContaining({
        googleEventId: 'gev-1',
        contentHash: computeContentHash(milestone),
      })
    );
  });
});

describe('syncMilestone — removal', () => {
  it('deletes event and mapping when publishExternally becomes false', async () => {
    const ctx = makeContext([makeMapping()]);

    expect(await syncMilestone(makeMilestone({ publishExternally: false }), ctx)).toBe(true);

    expect(google.deleteEvent).toHaveBeenCalledWith('gcal-1', 'gev-1');
    expect(ctx.deleteMapping).toHaveBeenCalledWith('m1', 'fn-a');
    expect(google.createEvent).not.toHaveBeenCalled();
  });

  it('with publishExternally false and no mapping it does nothing', async () => {
    const ctx = makeContext();

    expect(await syncMilestone(makeMilestone({ publishExternally: false }), ctx)).toBe(false);

    expect(google.deleteEvent).not.toHaveBeenCalled();
    expect(ctx.deleteMapping).not.toHaveBeenCalled();
  });

  it('removes the mappings of functions no longer visible', async () => {
    // Removing a function from the visibility must make the event disappear from its
    // calendar: without this branch it would stay visible to people no longer entitled.
    const ctx = makeContext([
      makeMapping({ companyFunctionId: 'fn-a' }),
      makeMapping({
        companyFunctionId: 'fn-rimossa',
        googleEventId: 'gev-2',
        googleCalendarId: 'gcal-2',
      }),
    ]);

    await syncMilestone(makeMilestone({ visibilityFunctionIds: ['fn-a'] }), ctx);

    expect(google.deleteEvent).toHaveBeenCalledWith('gcal-2', 'gev-2');
    expect(ctx.deleteMapping).toHaveBeenCalledWith('m1', 'fn-rimossa');
    expect(ctx.deleteMapping).not.toHaveBeenCalledWith('m1', 'fn-a');
  });

  it('emptying the visibility removes every event', async () => {
    const ctx = makeContext([
      makeMapping({ companyFunctionId: 'fn-a' }),
      makeMapping({ companyFunctionId: 'fn-b', googleEventId: 'gev-2' }),
    ]);

    expect(await syncMilestone(makeMilestone({ visibilityFunctionIds: [] }), ctx)).toBe(true);

    expect(google.deleteEvent).toHaveBeenCalledTimes(2);
    expect(ctx.deleteMapping).toHaveBeenCalledTimes(2);
  });
});

describe('syncMilestone — retry policy', () => {
  it('retries transient errors and succeeds', async () => {
    google.createEvent
      .mockRejectedValueOnce(Object.assign(new Error('503'), { code: 503 }))
      .mockResolvedValueOnce('gev-nuovo');

    await syncMilestone(makeMilestone(), makeContext());

    expect(google.createEvent).toHaveBeenCalledTimes(2);
  });

  it('does not retry 4xx', async () => {
    // A malformed or unauthorized request does not get better by retrying: insisting
    // would waste API quota and delay the real error.
    google.createEvent.mockRejectedValue(
      Object.assign(new Error('400'), { code: 400 })
    );

    await expect(syncMilestone(makeMilestone(), makeContext())).rejects.toThrow(
      '400'
    );
    expect(google.createEvent).toHaveBeenCalledTimes(1);
  });

  it('retries the 429, which is transient despite being a 4xx', async () => {
    google.createEvent
      .mockRejectedValueOnce(Object.assign(new Error('429'), { code: 429 }))
      .mockResolvedValueOnce('gev-nuovo');

    await syncMilestone(makeMilestone(), makeContext());

    expect(google.createEvent).toHaveBeenCalledTimes(2);
  });
});
