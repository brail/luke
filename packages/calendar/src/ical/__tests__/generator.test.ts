import { describe, it, expect } from 'vitest';

import { generateIcal } from '../generator.js';

import type { ICalMilestone } from '../generator.js';

/**
 * The .ics feed is consumed by external clients (Outlook, Apple Calendar, Google): a
 * non-compliant output raises no error anywhere, it simply does not get imported. This
 * checks the RFC 5545 structure and the few domain rules.
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
  it('produces a calendar with a name and PRODID', () => {
    const ics = generateIcal([], 'Calendario Test', '-//Custom//Test//EN');

    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('END:VCALENDAR');
    expect(ics).toContain('-//Custom//Test//EN');
    expect(ics).toContain('Calendario Test');
  });

  it('generates a valid calendar even without milestones', () => {
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

  it('uses a stable UID derived from the milestone id', () => {
    // The UID is how the client tells a "new event" from an "update": if it changed
    // on every generation, every refresh would duplicate the events.
    const ics = generateIcal([makeMilestone({ id: 'abc-123' })], 'Test');

    expect(ics).toContain('luke-milestone-abc-123@luke.app');
  });

  it('prefixes the brand code only on timed events', () => {
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

  it('uses startAt as the end when endAt is absent', () => {
    // Without this default `ical-generator` would reject the event: a missing `end`
    // is not allowed by the library.
    const ics = generateIcal(
      [makeMilestone({ endAt: null, allDay: false })],
      'Test'
    );

    expect(ics).toContain('BEGIN:VEVENT');
    expect(ics).toContain('DTSTART');
    expect(ics).toContain('DTEND');
  });

  it('omits the description when it is null', () => {
    const ics = generateIcal([makeMilestone({ description: null })], 'Test');

    expect(ics).not.toContain('DESCRIPTION:');
  });

  it('includes the description when present', () => {
    const ics = generateIcal(
      [makeMilestone({ description: 'Note interne' })],
      'Test'
    );

    expect(ics).toContain('Note interne');
  });

  it('uses the plain date format for all-day events', () => {
    const allDay = generateIcal([makeMilestone({ allDay: true })], 'Test');

    // All-day → `DTSTART;VALUE=DATE:20990301`, with no time component.
    expect(allDay).toMatch(/DTSTART[^:\n]*VALUE=DATE[^:\n]*:\d{8}/);
  });
});
