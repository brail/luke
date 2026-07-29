import { describe, it, expect } from 'vitest';

import { generateIcal } from '../generator.js';

import type { ICalMilestone } from '../generator.js';

/**
 * Il feed .ics è consumato da client esterni (Outlook, Apple Calendar, Google):
 * un output non conforme non dà errore da nessuna parte, semplicemente non viene
 * importato. Qui si verifica la struttura RFC 5545 e le poche regole di dominio.
 */
function makeMilestone(
  overrides: Partial<ICalMilestone> = {}
): ICalMilestone {
  return {
    id: 'm1',
    title: 'Consegna campionario',
    description: 'Descrizione',
    startAt: new Date('2099-03-01T09:00:00.000Z'),
    endAt: new Date('2099-03-01T18:00:00.000Z'),
    allDay: false,
    cancelled: false,
    brandCode: 'ACME',
    ...overrides,
  };
}

describe('generateIcal', () => {
  it('produce un calendario con nome e PRODID', () => {
    const ics = generateIcal([], 'Calendario Test', '-//Custom//Test//EN');

    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('END:VCALENDAR');
    expect(ics).toContain('-//Custom//Test//EN');
    expect(ics).toContain('Calendario Test');
  });

  it('genera un calendario valido anche senza milestone', () => {
    const ics = generateIcal([], 'Vuoto');

    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).not.toContain('BEGIN:VEVENT');
  });

  it('emette un VEVENT per milestone', () => {
    const ics = generateIcal(
      [makeMilestone({ id: 'a' }), makeMilestone({ id: 'b' })],
      'Test'
    );

    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
  });

  it('usa un UID stabile derivato dall\'id della milestone', () => {
    // L'UID è ciò con cui il client distingue "nuovo evento" da "aggiornamento":
    // se cambiasse ad ogni generazione, ogni refresh duplicherebbe gli eventi.
    const ics = generateIcal([makeMilestone({ id: 'abc-123' })], 'Test');

    expect(ics).toContain('luke-milestone-abc-123@luke.app');
  });

  it('prefissa il brand code solo sugli eventi con orario', () => {
    const timed = generateIcal(
      [makeMilestone({ allDay: false, title: 'Riunione' })],
      'Test'
    );
    const allDay = generateIcal(
      [makeMilestone({ allDay: true, title: 'Riunione' })],
      'Test'
    );

    expect(timed).toContain('[ACME] Riunione');
    expect(allDay).not.toContain('[ACME]');
    expect(allDay).toContain('Riunione');
  });

  it('marca CANCELLED le milestone annullate e CONFIRMED le altre', () => {
    expect(generateIcal([makeMilestone({ cancelled: true })], 'Test')).toContain(
      'STATUS:CANCELLED'
    );
    expect(
      generateIcal([makeMilestone({ cancelled: false })], 'Test')
    ).toContain('STATUS:CONFIRMED');
  });

  it('usa startAt come fine quando endAt è assente', () => {
    // Senza questo default `ical-generator` rifiuterebbe l'evento: un `end`
    // mancante non è ammesso dalla libreria.
    const ics = generateIcal(
      [makeMilestone({ endAt: null, allDay: false })],
      'Test'
    );

    expect(ics).toContain('BEGIN:VEVENT');
    expect(ics).toContain('DTSTART');
    expect(ics).toContain('DTEND');
  });

  it('omette la descrizione quando è null', () => {
    const ics = generateIcal([makeMilestone({ description: null })], 'Test');

    expect(ics).not.toContain('DESCRIPTION:');
  });

  it('include la descrizione quando presente', () => {
    const ics = generateIcal(
      [makeMilestone({ description: 'Note interne' })],
      'Test'
    );

    expect(ics).toContain('Note interne');
  });

  it('usa il formato data pura per gli eventi all-day', () => {
    const allDay = generateIcal([makeMilestone({ allDay: true })], 'Test');

    // All-day → `DTSTART;VALUE=DATE:20990301`, senza componente oraria.
    expect(allDay).toMatch(/DTSTART[^:\n]*VALUE=DATE[^:\n]*:\d{8}/);
  });
});
