import { useState } from 'react';
import { expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';

import { type CalendarDate } from '@luke/core';

import { date } from '../../../../../lib/__browser__/zoneFixtures';
import { CalendarEventDayView } from '../CalendarEventDayView';
import { CalendarEventGantt } from '../CalendarEventGantt';
import { EventTimelineDrag } from '../PlanningWizard/EventTimelineDrag';

import type { CalendarEventItem } from '../types';

/**
 * A cancelled pointer (a touch taken over by the browser, a lost capture) cancels the drag (#154):
 * nothing is saved, the preview reverts, and the release that may follow is no longer a drop. Each
 * case also drops without a cancel, so a drag that never started cannot pass.
 */

const ZONE = 'Europe/Rome';
const noop = () => {};

const event: CalendarEventItem = {
  id: 'e1',
  title: 'Evento A',
  startAt: '2026-04-13T07:00:00.000Z',
  endAt: '2026-04-13T08:00:00.000Z',
  allDay: false,
  publishExternally: false,
  visibilities: [],
  planningGroupId: 'g1',
};

const fire = (target: EventTarget, type: string, x: number, y: number) =>
  target.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, pointerId: 1 }));

const views = [
  {
    name: 'day view',
    selector: '[class*="absolute rounded-r"]',
    position: (el: HTMLElement) => el.style.top,
    saved: { startAt: '2026-04-13T09:00:00.000Z', endAt: '2026-04-13T10:00:00.000Z' },
    ui: (onEventUpdate: () => void) => (
      <CalendarEventDayView milestones={[event]} viewDate={date('2026-04-13')} zone={ZONE} onViewDateChange={noop}
        onEventClick={noop} onEventUpdate={onEventUpdate} brandColorMap={{}} canUpdate />
    ),
  },
  {
    name: 'gantt',
    selector: '[title^="Evento A"]',
    position: (el: HTMLElement) => el.style.left,
    saved: { startAt: '2026-04-18T07:00:00.000Z' },
    ui: (onEventUpdate: () => void) => (
      <CalendarEventGantt milestones={[event]} zone={ZONE} onEventClick={noop} onEventUpdate={onEventUpdate}
        functionsById={{}} brandColorMap={{}} canUpdate />
    ),
  },
];

test.each(views)('$name saves a released drag', async ({ selector, saved, ui }) => {
  const onEventUpdate = vi.fn();
  const screen = await render(ui(onEventUpdate));
  const el = screen.container.querySelector<HTMLElement>(selector)!;

  fire(el, 'pointerdown', 100, 100);
  // 112px is two hours in the day view, 120px five days in the Gantt.
  fire(window, 'pointerup', 220, 212);

  expect(onEventUpdate).toHaveBeenCalledOnce();
  expect(onEventUpdate).toHaveBeenCalledWith('e1', expect.objectContaining(saved));
});

test.each(views)('$name cancels the drag on pointercancel', async ({ selector, position, ui }) => {
  const onEventUpdate = vi.fn();
  const screen = await render(ui(onEventUpdate));
  const el = screen.container.querySelector<HTMLElement>(selector)!;
  const before = position(el);

  fire(el, 'pointerdown', 100, 100);
  fire(window, 'pointermove', 220, 220);
  await vi.waitFor(() => expect(position(screen.container.querySelector<HTMLElement>(selector)!)).not.toBe(before));

  fire(window, 'pointercancel', 220, 220);
  await vi.waitFor(() => expect(position(screen.container.querySelector<HTMLElement>(selector)!)).toBe(before));

  fire(window, 'pointerup', 220, 220);
  expect(onEventUpdate).not.toHaveBeenCalled();
});

/** The marker with its date held the way the wizard holds its draft. */
function Marker({ onChange }: { onChange: (d: CalendarDate) => void }) {
  const [value, setValue] = useState(date('2026-04-13'));
  return (
    <EventTimelineDrag anchorDate={date('2026-04-13')} value={value} holidayDates={new Map()} closedDates={new Set()}
      onChange={d => { onChange(d); setValue(d); }} />
  );
}

async function marker(onChange: (d: CalendarDate) => void) {
  const screen = await render(<Marker onChange={onChange} />);
  // The marker is a div: the locator's return type also admits SVG elements.
  const el = screen.getByRole('button', { name: 'Sposta evento' }).element() as HTMLElement;
  // A synthetic pointer has no active id to capture, and the browser would throw.
  el.setPointerCapture = noop;
  return el;
}

/** Starts a drag and moves the marker to the first day of the strip, away from its date. */
async function dragAway(el: HTMLElement, onChange: (d: CalendarDate) => void) {
  fire(el, 'pointerdown', 100, 0);
  await vi.waitFor(() => {
    fire(el, 'pointermove', 0, 0);
    expect(onChange).toHaveBeenLastCalledWith(date('2026-04-04'));
  });
  // The draft date has rendered: the marker sits on the first cell.
  await vi.waitFor(() => expect(el.style.left).toBe('0px'));
}

test('wizard marker restores its date on pointercancel and stops following the pointer', async () => {
  const onChange = vi.fn();
  const el = await marker(onChange);
  await dragAway(el, onChange);

  fire(el, 'pointercancel', 0, 0);
  expect(onChange).toHaveBeenLastCalledWith(date('2026-04-13'));

  await new Promise(resolve => setTimeout(resolve));
  const calls = onChange.mock.calls.length;
  fire(el, 'pointermove', 0, 0);
  expect(onChange).toHaveBeenCalledTimes(calls);
});

test('wizard marker makes no change on a pointercancel without a move', async () => {
  const onChange = vi.fn();
  const el = await marker(onChange);

  fire(el, 'pointerdown', 100, 0);
  await new Promise(resolve => setTimeout(resolve));
  fire(el, 'pointercancel', 100, 0);

  expect(onChange).not.toHaveBeenCalled();
});

test.each(['pointerup', 'lostpointercapture'])('wizard marker keeps the dragged date on %s and stops following the pointer', async type => {
  const onChange = vi.fn();
  const el = await marker(onChange);
  await dragAway(el, onChange);

  fire(el, type, 0, 0);
  // Retried: React renders a lost capture through the scheduler, not in a microtask.
  await vi.waitFor(() => {
    const calls = onChange.mock.calls.length;
    fire(el, 'pointermove', 0, 0);
    expect(onChange).toHaveBeenCalledTimes(calls);
  });

  expect(onChange).toHaveBeenLastCalledWith(date('2026-04-04'));
});
