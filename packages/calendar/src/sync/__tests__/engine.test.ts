import { describe, it, expect, beforeEach, vi } from 'vitest';

// `vi.mock` viene issato sopra gli import: i mock sono già attivi quando
// `engine.js` viene caricato, quindi l'import statico è sicuro.
import { provisionBinding, syncMilestone } from '../engine.js';
import { computeContentHash } from '../hash.js';

import { makeMilestone as makeSharedMilestone } from './fixtures.js';

import type {
  GoogleEventMappingRecord,
  MilestoneForSync,
  SyncContext,
} from '../types.js';

/**
 * `syncMilestone` è l'unico punto che decide cosa succede sui calendari Google.
 * Ogni ramo sbagliato è invisibile lato Luke e visibile solo agli utenti finali:
 * un evento che non sparisce quando dovrebbe, o che riappare dove non deve.
 */
const google = vi.hoisted(() => ({
  createEvent: vi.fn(),
  updateEvent: vi.fn(),
  deleteEvent: vi.fn(),
  createCalendar: vi.fn(),
  buildCalendarSummary: vi.fn(
    (b: string, s: string, l: string) => `Luke • ${b} • ${s} • ${l}`
  ),
  syncCalendarReaders: vi.fn(),
  enforceDomainReadOnly: vi.fn(),
}));

vi.mock('../../google/events.js', () => ({
  createEvent: google.createEvent,
  updateEvent: google.updateEvent,
  deleteEvent: google.deleteEvent,
}));

vi.mock('../../google/calendars.js', () => ({
  createCalendar: google.createCalendar,
  buildCalendarSummary: google.buildCalendarSummary,
}));

vi.mock('../../google/acl.js', () => ({
  syncCalendarReaders: google.syncCalendarReaders,
  enforceDomainReadOnly: google.enforceDomainReadOnly,
}));

/**
 * Milestone visibile a **una sola** function.
 *
 * `syncMilestone` fa fan-out per function: con la fixture condivisa, che ne ha
 * due, ogni conteggio di chiamate a Google raddoppierebbe e i test sui singoli
 * rami misurerebbero il fan-out invece del ramo. Chi vuole il fan-out lo chiede
 * esplicitamente, come nel test dedicato.
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
    getAllowedEmailsForFunction: vi.fn(async () => ['a@example.com']),
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
  google.createCalendar.mockResolvedValue({ id: 'gcal-nuovo', summary: 'x' });
  google.syncCalendarReaders.mockResolvedValue(undefined);
  google.enforceDomainReadOnly.mockResolvedValue(undefined);
});

describe('syncMilestone — creazione', () => {
  it('crea l\'evento e salva il mapping quando non esiste', async () => {
    const ctx = makeContext();
    const milestone = makeMilestone();

    await syncMilestone(milestone, ctx);

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

  it('crea un evento per ogni function visibile', async () => {
    const ctx = makeContext();

    await syncMilestone(
      makeMilestone({ visibilityFunctionIds: ['fn-a', 'fn-b'] }),
      ctx
    );

    expect(google.createEvent).toHaveBeenCalledTimes(2);
    expect(ctx.upsertMapping).toHaveBeenCalledTimes(2);
  });

  it('mappa cancelled sullo status Google', async () => {
    await syncMilestone(makeMilestone({ cancelled: true }), makeContext());

    expect(google.createEvent).toHaveBeenCalledWith(
      'gcal-fn-a',
      expect.objectContaining({ status: 'cancelled' })
    );
  });
});

describe('syncMilestone — aggiornamento e skip', () => {
  it('salta quando l\'hash coincide', async () => {
    const milestone = makeMilestone();
    const ctx = makeContext([
      makeMapping({ contentHash: computeContentHash(milestone) }),
    ]);

    await syncMilestone(milestone, ctx);

    // Il senso stesso dell'hash: nessuna chiamata a Google per un evento
    // immutato. Se questo test cade, ogni sync riscrive tutto.
    expect(google.createEvent).not.toHaveBeenCalled();
    expect(google.updateEvent).not.toHaveBeenCalled();
    expect(ctx.upsertMapping).not.toHaveBeenCalled();
  });

  it('aggiorna in place quando l\'hash è diverso', async () => {
    const milestone = makeMilestone();
    const ctx = makeContext([makeMapping({ contentHash: 'obsoleto' })]);

    await syncMilestone(milestone, ctx);

    expect(google.updateEvent).toHaveBeenCalledWith(
      'gcal-1',
      'gev-1',
      expect.objectContaining({ title: '[LU] Consegna campionario' })
    );
    // Riusa l'evento esistente invece di crearne un altro: creare un secondo
    // evento lascerebbe un duplicato orfano sul calendario dell'utente.
    expect(google.createEvent).not.toHaveBeenCalled();
    expect(ctx.upsertMapping).toHaveBeenCalledWith(
      expect.objectContaining({
        googleEventId: 'gev-1',
        contentHash: computeContentHash(milestone),
      })
    );
  });
});

describe('syncMilestone — rimozione', () => {
  it('cancella evento e mapping quando publishExternally diventa false', async () => {
    const ctx = makeContext([makeMapping()]);

    await syncMilestone(makeMilestone({ publishExternally: false }), ctx);

    expect(google.deleteEvent).toHaveBeenCalledWith('gcal-1', 'gev-1');
    expect(ctx.deleteMapping).toHaveBeenCalledWith('m1', 'fn-a');
    expect(google.createEvent).not.toHaveBeenCalled();
  });

  it('con publishExternally false e nessun mapping non fa nulla', async () => {
    const ctx = makeContext();

    await syncMilestone(makeMilestone({ publishExternally: false }), ctx);

    expect(google.deleteEvent).not.toHaveBeenCalled();
    expect(ctx.deleteMapping).not.toHaveBeenCalled();
  });

  it('rimuove i mapping delle function non più visibili', async () => {
    // Togliere una function dalla visibilità deve far sparire l'evento dal suo
    // calendario: senza questo ramo resterebbe visibile a chi non ha più diritto.
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

  it('svuotare la visibilità rimuove tutti gli eventi', async () => {
    const ctx = makeContext([
      makeMapping({ companyFunctionId: 'fn-a' }),
      makeMapping({ companyFunctionId: 'fn-b', googleEventId: 'gev-2' }),
    ]);

    await syncMilestone(makeMilestone({ visibilityFunctionIds: [] }), ctx);

    expect(google.deleteEvent).toHaveBeenCalledTimes(2);
    expect(ctx.deleteMapping).toHaveBeenCalledTimes(2);
  });
});

describe('syncMilestone — politica di retry', () => {
  it('ritenta gli errori transitori e va a buon fine', async () => {
    google.createEvent
      .mockRejectedValueOnce(Object.assign(new Error('503'), { code: 503 }))
      .mockResolvedValueOnce('gev-nuovo');

    await syncMilestone(makeMilestone(), makeContext());

    expect(google.createEvent).toHaveBeenCalledTimes(2);
  });

  it('non ritenta i 4xx', async () => {
    // Una richiesta malformata o non autorizzata non migliora ritentando:
    // insistere sprecherebbe quota API e ritarderebbe l'errore reale.
    google.createEvent.mockRejectedValue(
      Object.assign(new Error('400'), { code: 400 })
    );

    await expect(syncMilestone(makeMilestone(), makeContext())).rejects.toThrow(
      '400'
    );
    expect(google.createEvent).toHaveBeenCalledTimes(1);
  });

  it('ritenta il 429, che è transitorio nonostante sia 4xx', async () => {
    google.createEvent
      .mockRejectedValueOnce(Object.assign(new Error('429'), { code: 429 }))
      .mockResolvedValueOnce('gev-nuovo');

    await syncMilestone(makeMilestone(), makeContext());

    expect(google.createEvent).toHaveBeenCalledTimes(2);
  });
});

describe('provisionBinding', () => {
  it('crea il calendario, imposta i lettori e blocca il dominio in sola lettura', async () => {
    const ctx = makeContext();

    const id = await provisionBinding(ctx, 'fn-a', 'Prodotto');

    expect(google.buildCalendarSummary).toHaveBeenCalledWith(
      'ACME',
      'FW25',
      'Prodotto'
    );
    expect(google.createCalendar).toHaveBeenCalledWith(
      'Luke • ACME • FW25 • Prodotto'
    );
    expect(google.syncCalendarReaders).toHaveBeenCalledWith('gcal-nuovo', [
      'a@example.com',
    ]);
    // Va chiamato SEMPRE dopo il provisioning: Google crea da sé una regola di
    // dominio che può scavalcare i permessi per utente.
    expect(google.enforceDomainReadOnly).toHaveBeenCalledWith('gcal-nuovo');
    expect(id).toBe('gcal-nuovo');
  });

  it('usa l\'id della function come etichetta quando manca il label', async () => {
    await provisionBinding(makeContext(), 'fn-a');

    expect(google.buildCalendarSummary).toHaveBeenCalledWith(
      'ACME',
      'FW25',
      'fn-a'
    );
  });
});
