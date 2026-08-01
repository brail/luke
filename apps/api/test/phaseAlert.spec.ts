/**
 * Test unitari per le funzioni pure del motore di alert (`phaseAlert.service.ts`)
 * che operano su un array di eventi già risolto — nessun accesso a Prisma, quindi
 * tier unit, non integration.
 *
 * Fixture minime: le funzioni sotto test leggono solo `id` e `phase.{order,isActive}`
 * dagli eventi; gli altri campi scalari di `CalendarEvent` sono valorizzati con
 * placeholder solo per soddisfare il tipo (derivato via `Parameters<>` invece di
 * importare il tipo privato `CalendarEventWithContext`, non esportato dal modulo —
 * questo file è test-only, non tocca codice applicativo).
 */

import { describe, it, expect } from 'vitest';

import {
  getActivePhaseFromEvents,
  getNextPhaseFromEvents,
  filterApplicableEvents,
  type ActivePhaseResult,
} from '../src/services/phaseAlert.service';

type RowEvent = Parameters<typeof getActivePhaseFromEvents>[0][number];

/** Costruisce un evento calendario minimo, con la sola fase che conta per questi test. */
function fakeEvent(opts: {
  id: string;
  planningGroupId?: string;
  phaseOrder: number | null;
  phaseIsActive?: boolean;
}): RowEvent {
  const now = new Date();
  return {
    id: opts.id,
    calendarId: 'cal-1',
    planningGroupId: opts.planningGroupId ?? 'pg-1',
    phaseId: opts.phaseOrder === null ? null : `phase-${opts.phaseOrder}`,
    calendarDaysRelevance: null,
    cancelledAt: null,
    cancelReason: null,
    cancelledByUserId: null,
    title: `Event ${opts.id}`,
    description: null,
    startAt: now,
    endAt: null,
    baselineStartAt: null,
    baselineEndAt: null,
    allDay: false,
    publishExternally: true,
    templateItemId: null,
    createdAt: now,
    updatedAt: now,
    phase: opts.phaseOrder === null ? null : {
      order: opts.phaseOrder,
      value: `PHASE_${opts.phaseOrder}`,
      isActive: opts.phaseIsActive ?? true,
    },
  } as unknown as RowEvent;
}

describe('getActivePhaseFromEvents', () => {
  it('nessun evento applicabile → no-calendar', () => {
    expect(getActivePhaseFromEvents([], null)).toEqual({ status: 'no-calendar' });
  });

  it('currentOrder null → il primo evento diventa attivo (riga non ancora a nessuna fase)', () => {
    const first = fakeEvent({ id: 'e1', phaseOrder: 0 });
    const second = fakeEvent({ id: 'e2', phaseOrder: 1 });
    const result = getActivePhaseFromEvents([first, second], null);
    expect(result).toEqual({ status: 'active', event: first });
  });

  it('currentOrder oltre l\'ultima fase applicabile → completed', () => {
    const events = [fakeEvent({ id: 'e1', phaseOrder: 0 })];
    expect(getActivePhaseFromEvents(events, 5)).toEqual({ status: 'completed' });
  });

  it('currentOrder uguale alla fase di un evento → quell\'evento è attivo (>=, non >)', () => {
    // La riga è "a" quella fase, non l'ha ancora superata — la sua scadenza si applica ancora.
    const atOrder1 = fakeEvent({ id: 'e2', phaseOrder: 1 });
    const events = [fakeEvent({ id: 'e1', phaseOrder: 0 }), atOrder1, fakeEvent({ id: 'e3', phaseOrder: 2 })];
    expect(getActivePhaseFromEvents(events, 1)).toEqual({ status: 'active', event: atOrder1 });
  });
});

describe('getNextPhaseFromEvents', () => {
  const notActive: ActivePhaseResult[] = [{ status: 'no-calendar' }, { status: 'completed' }];

  it.each(notActive)('nessuna fase attiva ($status) → null', active => {
    const events = [fakeEvent({ id: 'e1', phaseOrder: 0 })];
    expect(getNextPhaseFromEvents(events, active)).toBeNull();
  });

  it('fase attiva con un evento successivo a order maggiore → lo ritorna', () => {
    const active = fakeEvent({ id: 'e1', phaseOrder: 0 });
    const next = fakeEvent({ id: 'e2', phaseOrder: 1 });
    const events = [active, next];
    expect(getNextPhaseFromEvents(events, { status: 'active', event: active })).toEqual(next);
  });

  it('la fase attiva è l\'ultima applicabile → null (nessuna prossima fase da mostrare)', () => {
    const active = fakeEvent({ id: 'e1', phaseOrder: 2 });
    const events = [fakeEvent({ id: 'e0', phaseOrder: 0 }), active];
    expect(getNextPhaseFromEvents(events, { status: 'active', event: active })).toBeNull();
  });

  it('l\'unico candidato successivo è su una fase disattivata → null, non il candidato disattivato', () => {
    // Regressione: una fase disattivata (isActive:false) resta referenziata da un
    // CalendarEvent esistente ma sparisce dal catalogo (`phase.list` filtra
    // isActive:true) — mostrarla come "prossima fase" produceva un'etichetta
    // irrisolvibile lato frontend ("—") invece di nascondere semplicemente la riga.
    const active = fakeEvent({ id: 'e1', phaseOrder: 0 });
    const inactiveNext = fakeEvent({ id: 'e2', phaseOrder: 1, phaseIsActive: false });
    const events = [active, inactiveNext];
    expect(getNextPhaseFromEvents(events, { status: 'active', event: active })).toBeNull();
  });

  it('salta un candidato disattivato e trova il successivo attivo oltre', () => {
    const active = fakeEvent({ id: 'e1', phaseOrder: 0 });
    const inactiveNext = fakeEvent({ id: 'e2', phaseOrder: 1, phaseIsActive: false });
    const activeNext = fakeEvent({ id: 'e3', phaseOrder: 2, phaseIsActive: true });
    const events = [active, inactiveNext, activeNext];
    expect(getNextPhaseFromEvents(events, { status: 'active', event: active })).toEqual(activeNext);
  });

  it('più eventi sulla stessa fase attiva non contano come "prossima" — serve un order maggiore', () => {
    const active = fakeEvent({ id: 'e1', phaseOrder: 0 });
    const sameOrderDuplicate = fakeEvent({ id: 'e1b', phaseOrder: 0 });
    const nextPhase = fakeEvent({ id: 'e2', phaseOrder: 1 });
    const events = [active, sameOrderDuplicate, nextPhase];
    expect(getNextPhaseFromEvents(events, { status: 'active', event: active })).toEqual(nextPhase);
  });

  it('l\'evento attivo non fa parte dell\'array passato → null (activeIndex non trovato)', () => {
    const events = [fakeEvent({ id: 'e2', phaseOrder: 2 }), fakeEvent({ id: 'e3', phaseOrder: 3 })];
    // "Attivo" costruito a parte, con id che non compare in `events`.
    const foreignActive = { status: 'active' as const, event: fakeEvent({ id: 'not-in-array', phaseOrder: 1 }) };
    expect(getNextPhaseFromEvents(events, foreignActive)).toBeNull();
  });
});

describe('filterApplicableEvents', () => {
  it('esclude eventi di un altro planning group', () => {
    const mine = fakeEvent({ id: 'e1', planningGroupId: 'pg-1', phaseOrder: 0 });
    const other = fakeEvent({ id: 'e2', planningGroupId: 'pg-2', phaseOrder: 1 });
    expect(filterApplicableEvents([mine, other], 'pg-1')).toEqual([mine]);
  });

  it('ordina per phase.order crescente', () => {
    const late = fakeEvent({ id: 'e1', phaseOrder: 2 });
    const early = fakeEvent({ id: 'e2', phaseOrder: 0 });
    const mid = fakeEvent({ id: 'e3', phaseOrder: 1 });
    expect(filterApplicableEvents([late, early, mid], 'pg-1').map(e => e.id)).toEqual(['e2', 'e3', 'e1']);
  });
});
