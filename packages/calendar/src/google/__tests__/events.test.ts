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

/** Estrae il body inviato all'API dalla chiamata registrata sul mock. */
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
  it('restituisce l\'id dell\'evento creato', async () => {
    await expect(createEvent('cal-1', makeInput())).resolves.toBe('gev-1');
  });

  it('fallisce esplicitamente se Google non restituisce un id', async () => {
    // Senza id non è possibile salvare il mapping: proseguire in silenzio
    // creerebbe un evento orfano, impossibile da aggiornare o cancellare dopo.
    events.insert.mockResolvedValue({ data: {} });

    await expect(createEvent('cal-1', makeInput())).rejects.toThrow(
      'Google Calendar event creation returned no id'
    );
  });

  it('usa dateTime con timezone UTC per gli eventi con orario', async () => {
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

  it('usa date pura per gli eventi all-day', async () => {
    // Un all-day inviato come dateTime verrebbe mostrato da Google come evento
    // orario nel fuso del lettore, spostandosi di giorno per chi sta fuori UTC.
    await createEvent('cal-1', makeInput({ allDay: true }));

    expect(insertedBody().start).toEqual({ date: '2099-03-01' });
    expect(insertedBody().end).toEqual({ date: '2099-03-01' });
  });

  it('usa startAt come fine quando endAt manca', async () => {
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
  it('è idempotente: un 410 non è un errore', async () => {
    // 410 significa "già cancellato", cioè lo stato desiderato.
    events.delete.mockRejectedValue(
      Object.assign(new Error('Gone'), { code: 410 })
    );

    await expect(deleteEvent('cal-1', 'gev-1')).resolves.toBeUndefined();
  });

  it('propaga gli errori diversi dal 410', async () => {
    events.delete.mockRejectedValue(
      Object.assign(new Error('Boom'), { code: 500 })
    );

    await expect(deleteEvent('cal-1', 'gev-1')).rejects.toThrow('Boom');
  });
});
