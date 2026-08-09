import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
  enforceDomainReadOnly,
  listCalendarReaders,
  removeCalendarReader,
  syncCalendarReaders,
} from '../acl.js';

/**
 * L'ACL è ciò che impedisce a un calendario di stagione di essere leggibile da
 * chi non dovrebbe vederlo. Un errore di riconciliazione non produce eccezioni:
 * lascia semplicemente un lettore di troppo, in silenzio.
 */
const { acl, getWorkspaceDomain } = vi.hoisted(() => ({
  acl: {
    insert: vi.fn(),
    delete: vi.fn(),
    list: vi.fn(),
    get: vi.fn(),
    update: vi.fn(),
  },
  getWorkspaceDomain: vi.fn(() => 'example.com'),
}));

vi.mock('../client.js', () => ({
  getClient: () => ({ acl }),
  getWorkspaceDomain,
}));

/** Costruisce la risposta di `acl.list` come la restituisce l'API Google. */
function readersResponse(emails: string[]) {
  return {
    data: {
      items: emails.map(value => ({
        role: 'reader',
        scope: { type: 'user', value },
      })),
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  acl.insert.mockResolvedValue({});
  acl.delete.mockResolvedValue({});
  acl.update.mockResolvedValue({});
});

describe('listCalendarReaders', () => {
  it('restituisce solo le regole reader di tipo user', () => {
    acl.list.mockResolvedValue({
      data: {
        items: [
          { role: 'reader', scope: { type: 'user', value: 'a@example.com' } },
          // Rumore che non deve finire nell'elenco dei lettori
          { role: 'owner', scope: { type: 'user', value: 'owner@example.com' } },
          { role: 'reader', scope: { type: 'domain', value: 'example.com' } },
          { role: 'reader', scope: { type: 'user' } },
        ],
      },
    });

    return expect(listCalendarReaders('cal-1')).resolves.toEqual([
      'a@example.com',
    ]);
  });

  it('gestisce una risposta senza items', async () => {
    acl.list.mockResolvedValue({ data: {} });

    await expect(listCalendarReaders('cal-1')).resolves.toEqual([]);
  });
});

describe('syncCalendarReaders', () => {
  it('aggiunge i mancanti e rimuove quelli di troppo', async () => {
    acl.list.mockResolvedValue(
      readersResponse(['resta@example.com', 'esce@example.com'])
    );

    await syncCalendarReaders('cal-1', [
      'resta@example.com',
      'entra@example.com',
    ]);

    expect(acl.insert).toHaveBeenCalledTimes(1);
    expect(acl.insert).toHaveBeenCalledWith({
      calendarId: 'cal-1',
      requestBody: {
        role: 'reader',
        scope: { type: 'user', value: 'entra@example.com' },
      },
    });

    expect(acl.delete).toHaveBeenCalledTimes(1);
    expect(acl.delete).toHaveBeenCalledWith({
      calendarId: 'cal-1',
      ruleId: 'user:esce@example.com',
    });
  });

  it('non tocca nulla quando lo stato coincide già', async () => {
    acl.list.mockResolvedValue(readersResponse(['a@example.com']));

    await syncCalendarReaders('cal-1', ['a@example.com']);

    expect(acl.insert).not.toHaveBeenCalled();
    expect(acl.delete).not.toHaveBeenCalled();
  });

  it('svuota i lettori quando la lista attesa è vuota', async () => {
    // Caso critico: una function senza membri deve restare senza lettori, non
    // conservare quelli precedenti.
    acl.list.mockResolvedValue(
      readersResponse(['a@example.com', 'b@example.com'])
    );

    await syncCalendarReaders('cal-1', []);

    expect(acl.delete).toHaveBeenCalledTimes(2);
    expect(acl.insert).not.toHaveBeenCalled();
  });
});

describe('removeCalendarReader', () => {
  it('è idempotente: un 404 non è un errore', async () => {
    // Rimuovere un lettore già assente è lo stato desiderato, non un guasto.
    acl.delete.mockRejectedValue(Object.assign(new Error('Not Found'), { code: 404 }));

    await expect(
      removeCalendarReader('cal-1', 'a@example.com')
    ).resolves.toBeUndefined();
  });

  it('propaga gli errori diversi dal 404', async () => {
    acl.delete.mockRejectedValue(Object.assign(new Error('Boom'), { code: 500 }));

    await expect(
      removeCalendarReader('cal-1', 'a@example.com')
    ).rejects.toThrow('Boom');
  });
});

describe('enforceDomainReadOnly', () => {
  it('declassa a freeBusyReader una regola di dominio troppo permissiva', async () => {
    // Google applica la regola PIÙ permissiva fra quelle che combaciano: una
    // regola di dominio con `writer` scavalcherebbe i grant `reader` per utente.
    acl.get.mockResolvedValue({ data: { role: 'writer' } });

    await enforceDomainReadOnly('cal-1');

    expect(acl.update).toHaveBeenCalledWith({
      calendarId: 'cal-1',
      ruleId: 'domain:example.com',
      requestBody: {
        role: 'freeBusyReader',
        scope: { type: 'domain', value: 'example.com' },
      },
    });
  });

  it.each(['freeBusyReader', 'none'])(
    'non tocca una regola già a %s',
    async role => {
      acl.get.mockResolvedValue({ data: { role } });

      await enforceDomainReadOnly('cal-1');

      expect(acl.update).not.toHaveBeenCalled();
    }
  );

  it('non fa nulla se la regola di dominio non esiste', async () => {
    acl.get.mockRejectedValue(Object.assign(new Error('Not Found'), { code: 404 }));

    await expect(enforceDomainReadOnly('cal-1')).resolves.toBeUndefined();
    expect(acl.update).not.toHaveBeenCalled();
  });

  it('propaga gli errori diversi dal 404', async () => {
    acl.get.mockRejectedValue(Object.assign(new Error('Boom'), { code: 500 }));

    await expect(enforceDomainReadOnly('cal-1')).rejects.toThrow('Boom');
  });
});
