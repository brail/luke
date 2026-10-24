/**
 * Regression pin for #159: on a season whose calendars follow the catalog order, deriving the phase
 * order from the calendar must not change any alert. Recorded on the catalog-order engine, before the
 * switch, and kept unchanged after it.
 *
 * Three planning groups, their phase deadlines in catalog order (Disegno < Prototipo < Campioni):
 * A plans all three, B the last two, C all three on other dates. Rows sit at each phase of their
 * group, at no phase, at a phase their group does not plan but another group does (B at Disegno),
 * and two are concluded. `now` and the business zone are pinned. Pinned outputs: the criticality of
 * every row, the bottleneck index, the phases a row would skip by concluding, and which events the
 * "phase completed by every row" trigger snapshots.
 */

import { randomUUID } from 'crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { PrismaClient } from '@luke/db';

import { deleteConfig, saveConfig } from '../src/lib/configManager';
import { createRevisionsForCompletedPhase } from '../src/services/collectionLayoutAutoRevision.service';
import { computeBottleneckByEvent, computeCriticalityForLayout, resolveMissingPhasesForRow } from '../src/services/phaseAlert.service';

import { createCallerWithSession, createTestUser, setupTestDb } from './helpers';

const NOW = new Date('2031-02-15T10:00:00Z');

let prisma: PrismaClient;
let layoutId: string;
let groupC: string;
const rowIds = new Map<string, string>();
const lineOf = (rowId: string) => [...rowIds].find(([, id]) => id === rowId)?.[0] ?? rowId;
const idOf = (line: string) => {
  const id = rowIds.get(line);
  if (!id) throw new Error(`no row ${line}`);
  return id;
};

beforeAll(async () => {
  prisma = await setupTestDb();
  await saveConfig(prisma, 'app.defaultTimezone', 'Europe/Rome');
  await deleteConfig(prisma, 'collectionControl.alertThresholds');
  const uid = randomUUID().substring(0, 6).toUpperCase();

  const admin = await createTestUser('admin');
  const asAdmin = createCallerWithSession(admin.session);
  // Created in catalog order, so each gets the next position: Disegno < Prototipo < Campioni.
  const disegno = await asAdmin.phase.create({ value: `POR1_${uid}`, label: 'Disegno' });
  const prototipo = await asAdmin.phase.create({ value: `POR2_${uid}`, label: 'Prototipo' });
  const campioni = await asAdmin.phase.create({ value: `POR3_${uid}`, label: 'Campioni' });

  const [brand, season] = await Promise.all([
    prisma.brand.create({ data: { code: `PORB${uid}`, name: `POR Brand ${uid}`, isActive: true } }),
    prisma.season.create({ data: { code: `PORS${uid}`, name: `POR Season ${uid}`, year: 2031, isActive: true } }),
  ]);
  const calendar = await prisma.seasonCalendar.create({ data: { brandId: brand.id, seasonId: season.id } });
  const [a, b, c] = await Promise.all(['A', 'B', 'C'].map(name =>
    prisma.planningGroup.create({ data: { calendarId: calendar.id, name: `POR ${name} ${uid}` } })));
  groupC = c.id;

  const event = (planningGroupId: string, phaseId: string, title: string, day: string) => ({
    calendarId: calendar.id, planningGroupId, phaseId, title, startAt: new Date(day), allDay: true,
  });
  await prisma.calendarEvent.createMany({
    data: [
      event(a.id, disegno.id, 'A1 Disegno', '2031-01-15'),
      event(a.id, prototipo.id, 'A2 Prototipo', '2031-02-01'),
      event(a.id, campioni.id, 'A3 Campioni', '2031-03-01'),
      event(b.id, prototipo.id, 'B2 Prototipo', '2031-02-10'),
      event(b.id, campioni.id, 'B3 Campioni', '2031-03-10'),
      event(c.id, disegno.id, 'C1 Disegno', '2031-01-20'),
      event(c.id, prototipo.id, 'C2 Prototipo', '2031-02-05'),
      event(c.id, campioni.id, 'C3 Campioni', '2031-03-05'),
    ],
  });

  const layout = await prisma.collectionLayout.create({ data: { brandId: brand.id, seasonId: season.id } });
  layoutId = layout.id;
  const collectionGroup = await prisma.collectionGroup.create({ data: { collectionLayoutId: layout.id, name: 'Gruppo' } });
  const rows: [line: string, planningGroupId: string, phaseId: string | null, completedAt?: string][] = [
    ['A-P1', a.id, disegno.id], ['A-P2', a.id, prototipo.id], ['A-P3', a.id, campioni.id], ['A-0', a.id, null],
    ['A-done', a.id, campioni.id, '2031-02-20T12:00:00Z'],
    ['B-P1', b.id, disegno.id], ['B-P2', b.id, prototipo.id], ['B-P3', b.id, campioni.id], ['B-0', b.id, null],
    ['B-done', b.id, prototipo.id, '2031-03-20T12:00:00Z'],
    ['C-P2', c.id, prototipo.id], ['C-P3', c.id, campioni.id],
  ];
  for (const [line, planningGroupId, phaseId, completedAt] of rows) {
    const row = await prisma.collectionLayoutRow.create({
      data: {
        collectionLayoutId: layout.id, groupId: collectionGroup.id, planningGroupId, phaseId,
        gender: 'MAN', line, status: 'TEST', productCategory: 'TEST', completedAt: completedAt ? new Date(completedAt) : null,
      },
    });
    rowIds.set(line, row.id);
  }
});

afterAll(async () => {
  await deleteConfig(prisma, 'app.defaultTimezone');
});

describe('phase alerts on a season whose calendars follow the catalog order', () => {
  it('measures every row against the same milestone, with the same band', async () => {
    const criticality = await computeCriticalityForLayout(layoutId, NOW, prisma);
    const pinned = Object.fromEntries(criticality.map(r => [lineOf(r.rowId), r.state === 'active'
      ? `${r.eventTitle} | ${r.band.label} | ${r.daysToDeadline} | ${r.reached ? 'reached' : 'open'} | next ${r.nextPhase?.eventTitle ?? '-'}`
      : `concluded on ${r.eventTitle} | ${r.band.label} | ${r.daysVsDeadline}`]));

    expect(pinned).toEqual({
      'A-P1': 'A1 Disegno | In ritardo | -31 | reached | next A2 Prototipo',
      'A-P2': 'A2 Prototipo | In ritardo | -14 | reached | next A3 Campioni',
      'A-P3': 'A3 Campioni | Attenzione | 14 | open | next -',
      'A-0': 'A1 Disegno | In ritardo | -31 | reached | next A2 Prototipo',
      'A-done': 'concluded on A3 Campioni | Concluso | 9',
      'B-P1': 'B2 Prototipo | In ritardo | -5 | reached | next B3 Campioni',
      'B-P2': 'B2 Prototipo | In ritardo | -5 | reached | next B3 Campioni',
      'B-P3': 'B3 Campioni | In linea | 23 | open | next -',
      'B-0': 'B2 Prototipo | In ritardo | -5 | reached | next B3 Campioni',
      'B-done': 'concluded on B3 Campioni | Concluso in ritardo | -10',
      'C-P2': 'C2 Prototipo | In ritardo | -10 | reached | next C3 Campioni',
      'C-P3': 'C3 Campioni | Attenzione | 18 | open | next -',
    });
  });

  it('holds up the same rows on the same milestones', async () => {
    const bottleneck = await computeBottleneckByEvent(layoutId, NOW, prisma);

    expect(bottleneck.map(e => `${e.eventTitle}: ${e.bands.map(b => `${b.count} ${b.label}`).join(', ')}`)).toEqual([
      'A1 Disegno: 2 In ritardo',
      'A2 Prototipo: 1 In ritardo',
      'C2 Prototipo: 1 In ritardo',
      'B2 Prototipo: 3 In ritardo',
      'A3 Campioni: 1 Attenzione',
      'C3 Campioni: 1 Attenzione',
      'B3 Campioni: 1 In linea',
    ]);
  });

  it('names the same phases a row would skip by concluding', async () => {
    const skipped = async (line: string) => (await resolveMissingPhasesForRow(idOf(line), prisma)).map(p => p.label);

    expect({
      'A-P1': await skipped('A-P1'),
      'A-P3': await skipped('A-P3'),
      'A-0': await skipped('A-0'),
      'B-P1': await skipped('B-P1'),
      'B-P3': await skipped('B-P3'),
      'B-0': await skipped('B-0'),
    }).toEqual({
      'A-P1': ['Prototipo', 'Campioni'],
      'A-P3': [],
      'A-0': ['Disegno', 'Prototipo', 'Campioni'],
      'B-P1': ['Prototipo', 'Campioni'],
      'B-P3': [],
      'B-0': ['Prototipo', 'Campioni'],
    });
  });

  it('snapshots the same milestones once every row of a group has reached their phase', async () => {
    // Group C's rows sit at Prototipo and Campioni: Disegno and Prototipo are cleared.
    expect(await createRevisionsForCompletedPhase(prisma, layoutId, groupC)).toBe(2);

    const revisions = await prisma.collectionLayoutRevision.findMany({
      where: { collectionLayoutId: layoutId, revisionTypeValue: 'MILESTONE_FASE' },
      select: { notes: true },
      orderBy: { notes: 'asc' },
    });
    expect(revisions.map(r => r.notes?.split(' — ')[0])).toEqual(['Fase completata: "C1 Disegno"', 'Fase completata: "C2 Prototipo"']);
  });
});
