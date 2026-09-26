import { describe, it, expect, beforeEach, vi } from 'vitest';

import { createEvent, deleteEvent, updateEvent } from '../events.js';

import type { EventInput } from '../events.js';

const { events } = vi.hoisted(() => ({
  events: {
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('../client.js', () => ({
  getClient: () => ({ events }),
  getWorkspaceDomain: () => 'example.com',
}));

function makeInput(overrides: Partial<EventInput> = {}): EventInput {
  return {
    title: 'Consegna campionario',
    description: 'Descrizione',
    startAt: new Date('2099-03-01T09:00:00.000Z'),
    endAt: new Date('2099-03-01T18:00:00.000Z'),
    allDay: false,
    status: 'confirmed',
    ...overrides,
  };
}

/** Extracts the body sent to the API from the call recorded on the mock. */
function insertedBody() {
  return events.insert.mock.calls[0]![0].requestBody;
}

beforeEach(() => {
  vi.clearAllMocks();
  events.insert.mockResolvedValue({ data: { id: 'gev-1' } });
  events.update.mockResolvedValue({});
  events.delete.mockResolvedValue({});
});

describe('createEvent', () => {
  it('returns the id of the created event', async () => {
    await expect(createEvent('cal-1', makeInput())).resolves.toBe('gev-1');
  });

  it('fails explicitly if Google returns no id', async () => {
    // Without an id the mapping cannot be saved: carrying on silently would create an
    // orphan event, impossible to update or delete later.
    events.insert.mockResolvedValue({ data: {} });

    await expect(createEvent('cal-1', makeInput())).rejects.toThrow(
      'Google Calendar event creation returned no id'
    );
  });

  it('uses dateTime with a UTC timezone for timed events', async () => {
    await createEvent('cal-1', makeInput({ allDay: false }));

    expect(insertedBody().start).toEqual({
      dateTime: '2099-03-01T09:00:00.000Z',
      timeZone: 'UTC',
    });
    expect(insertedBody().end).toEqual({
      dateTime: '2099-03-01T18:00:00.000Z',
      timeZone: 'UTC',
    });
  });

  it('uses a plain date for all-day events', async () => {
    // An all-day event sent as dateTime would be shown by Google as a timed event in the
    // reader's timezone, shifting by a day for anyone outside UTC.
    await createEvent('cal-1', makeInput({ allDay: true }));

    expect(insertedBody().start).toEqual({ date: '2099-03-01' });
    expect(insertedBody().end).toEqual({ date: '2099-03-01' });
  });

  it('uses startAt as the end when endAt is missing', async () => {
    await createEvent('cal-1', makeInput({ endAt: undefined }));

    expect(insertedBody().end).toEqual({
      dateTime: '2099-03-01T09:00:00.000Z',
      timeZone: 'UTC',
    });
  });

  it('propaga titolo, descrizione e status', async () => {
    await createEvent('cal-1', makeInput({ status: 'cancelled' }));

    expect(insertedBody()).toMatchObject({
      summary: 'Consegna campionario',
      description: 'Descrizione',
      status: 'cancelled',
    });
  });
});

describe('updateEvent', () => {
  it('sostituisce l\'evento indirizzando calendario ed evento corretti', async () => {
    await updateEvent('cal-1', 'gev-1', makeInput({ title: 'Nuovo titolo' }));

    expect(events.update).toHaveBeenCalledWith({
      calendarId: 'cal-1',
      eventId: 'gev-1',
      requestBody: expect.objectContaining({ summary: 'Nuovo titolo' }),
    });
  });
});

describe('deleteEvent', () => {
  it('is idempotent: a 410 is not an error', async () => {
    // 410 means "already deleted", i.e. the desired state.
    events.delete.mockRejectedValue(
      Object.assign(new Error('Gone'), { code: 410 })
    );

    await expect(deleteEvent('cal-1', 'gev-1')).resolves.toBeUndefined();
  });

  it('propagates errors other than 410', async () => {
    events.delete.mockRejectedValue(
      Object.assign(new Error('Boom'), { code: 500 })
    );

    await expect(deleteEvent('cal-1', 'gev-1')).rejects.toThrow('Boom');
  });
});
