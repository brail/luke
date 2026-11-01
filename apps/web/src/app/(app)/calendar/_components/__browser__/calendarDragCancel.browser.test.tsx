import { useState } from 'react';
import { expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';

import { type CalendarDate } from '@luke/core';

import { date } from '../../../../../lib/__browser__/zoneFixtures';
import { CalendarEventDayView } from '../CalendarEventDayView';
import { CalendarEventGantt } from '../CalendarEventGantt';
import { CalendarEventMonthView } from '../CalendarEventMonthView';
import { CalendarEventWeekView } from '../CalendarEventWeekView';
import { EventTimelineDrag } from '../PlanningWizard/EventTimelineDrag';

import type { CalendarEventItem } from '../types';

/**
 * A cancelled pointer (a touch taken over by the browser, a lost capture) cancels the drag (#154):
 * nothing is saved, the preview reverts, and the release that may follow is no longer a drop. A
 * drag saves only a primary-button move released while its view is mounted (#189). `dragTo` waits
 * for the preview, so a drag that never started cannot pass.
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

const fire = (target: EventTarget, type: string, x: number, y: number, button = 0) =>
  target.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, pointerId: 1, isPrimary: true, button }));

type Handlers = { onEventUpdate?: () => void; onEventClick?: () => void; onDayClick?: () => void; canUpdate?: boolean };

const views = [
  {
    name: 'day view',
    selector: '[class*="absolute rounded-r"]',
    clickTarget: (el: HTMLElement) => el.querySelector('button')!,
    row: (_el: HTMLElement, container: HTMLElement) => container.querySelector<HTMLElement>('.cursor-pointer')!,
    position: (el: HTMLElement) => el.style.top,
    saved: { startAt: '2026-04-13T09:00:00.000Z', endAt: '2026-04-13T10:00:00.000Z' },
    ui: ({ onEventUpdate = noop, onEventClick = noop, onDayClick = noop, canUpdate = true }: Handlers) => (
      <CalendarEventDayView milestones={[event]} viewDate={date('2026-04-13')} zone={ZONE} onViewDateChange={noop}
        onEventClick={onEventClick} onEventUpdate={onEventUpdate} onDayClick={onDayClick} brandColorMap={{}} canUpdate={canUpdate} />
    ),
  },
  {
    name: 'gantt',
    selector: '[title^="Evento A"]',
    clickTarget: (el: HTMLElement) => el,
    row: (el: HTMLElement) => el.closest<HTMLElement>('.relative.flex-1')!,
    position: (el: HTMLElement) => el.style.left,
    saved: { startAt: '2026-04-18T07:00:00.000Z' },
    ui: ({ onEventUpdate = noop, onEventClick = noop, onDayClick = noop, canUpdate = true }: Handlers) => (
      <CalendarEventGantt milestones={[event]} zone={ZONE} onEventClick={onEventClick} onEventUpdate={onEventUpdate}
        onDayClick={onDayClick} functionsById={{}} brandColorMap={{}} canUpdate={canUpdate} />
    ),
  },
];

/** Long enough for a drop that should not happen to have happened. */
const settle = () => new Promise(resolve => setTimeout(resolve, 20));

/** Presses `el`, passes the sensor's activation distance and moves until the preview shows it. */
async function dragTo(el: HTMLElement, position: (el: HTMLElement) => string, x: number, y: number) {
  const before = position(el);
  fire(el, 'pointerdown', 100, 100);
  fire(document, 'pointermove', 110, 110);
  await vi.waitFor(() => {
    fire(document, 'pointermove', x, y);
    expect(position(el)).not.toBe(before);
  });
  return before;
}

test.each(views)('$name saves a released drag', async ({ selector, position, saved, ui }) => {
  const onEventUpdate = vi.fn();
  const screen = await render(ui({ onEventUpdate }));

  // 112px is two hours in the day view, 120px five days in the Gantt.
  await dragTo(screen.container.querySelector<HTMLElement>(selector)!, position, 220, 212);
  fire(document, 'pointerup', 220, 212);

  await vi.waitFor(() => expect(onEventUpdate).toHaveBeenCalledOnce());
  expect(onEventUpdate).toHaveBeenCalledWith('e1', expect.objectContaining(saved));
});

test('gantt saves a resize as the new end alone', async () => {
  const onEventUpdate = vi.fn();
  const screen = await render(views[1]!.ui({ onEventUpdate }));
  const bar = screen.container.querySelector<HTMLElement>('[title^="Evento A"]')!;

  await dragTo(bar.querySelector<HTMLElement>('.cursor-ew-resize')!, () => bar.style.width, 220, 100);
  fire(document, 'pointerup', 220, 100);

  await vi.waitFor(() => expect(onEventUpdate).toHaveBeenCalledOnce());
  expect(onEventUpdate).toHaveBeenCalledWith('e1', { endAt: '2026-04-18T08:00:00.000Z' });
});

test.each(views)('$name cancels the drag on pointercancel', async ({ selector, position, ui }) => {
  const onEventUpdate = vi.fn();
  const screen = await render(ui({ onEventUpdate }));
  const el = screen.container.querySelector<HTMLElement>(selector)!;

  const before = await dragTo(el, position, 220, 220);
  fire(document, 'pointercancel', 220, 220);
  await vi.waitFor(() => expect(position(el)).toBe(before));

  fire(document, 'pointerup', 220, 220);
  await settle();
  expect(onEventUpdate).not.toHaveBeenCalled();
});

test.each(views)('$name starts no drag from a secondary button', async ({ selector, position, ui }) => {
  const onEventUpdate = vi.fn();
  const screen = await render(ui({ onEventUpdate }));
  const el = screen.container.querySelector<HTMLElement>(selector)!;
  const before = position(el);

  fire(el, 'pointerdown', 100, 100, 2);
  fire(document, 'pointermove', 110, 110, 2);
  fire(document, 'pointermove', 220, 212, 2);
  await settle();
  expect(position(el)).toBe(before);

  fire(document, 'pointerup', 220, 212, 2);
  await settle();
  expect(onEventUpdate).not.toHaveBeenCalled();
});

test.each(views)('$name starts no drag without the permission to edit', async ({ selector, position, ui }) => {
  const onEventUpdate = vi.fn();
  const screen = await render(ui({ onEventUpdate, canUpdate: false }));
  const el = screen.container.querySelector<HTMLElement>(selector)!;
  const before = position(el);

  fire(el, 'pointerdown', 100, 100);
  fire(document, 'pointermove', 110, 110);
  fire(document, 'pointermove', 220, 212);
  await settle();
  expect(position(el)).toBe(before);

  fire(document, 'pointerup', 220, 212);
  await settle();
  expect(onEventUpdate).not.toHaveBeenCalled();
});

test.each(views)('$name opens the event on a plain click', async ({ selector, clickTarget, ui }) => {
  const onEventClick = vi.fn();
  const onEventUpdate = vi.fn();
  const screen = await render(ui({ onEventClick, onEventUpdate }));
  const el = screen.container.querySelector<HTMLElement>(selector)!;

  // Under the sensor's activation distance, so no drag has started.
  fire(el, 'pointerdown', 100, 100);
  fire(document, 'pointermove', 102, 102);
  fire(document, 'pointerup', 102, 102);
  await settle();
  clickTarget(el).click();

  expect(onEventClick).toHaveBeenCalledOnce();
  expect(onEventUpdate).not.toHaveBeenCalled();
});

test.each(views)('$name saves nothing on a release after unmounting', async ({ selector, position, ui }) => {
  const onEventUpdate = vi.fn();
  const screen = await render(ui({ onEventUpdate }));

  await dragTo(screen.container.querySelector<HTMLElement>(selector)!, position, 220, 212);
  await screen.unmount();
  fire(document, 'pointerup', 220, 212);

  await settle();
  expect(onEventUpdate).not.toHaveBeenCalled();
});

test.each(views)('$name takes row and event clicks again after a drop', async ({ selector, clickTarget, row, position, ui }) => {
  // dnd-kit lifts a drag's click suppression 50ms after its release, and that timer also lifts the
  // suppression of a later drag: let the previous test's run out. No user drags twice in 50ms.
  await new Promise(resolve => setTimeout(resolve, 60));
  const onEventClick = vi.fn();
  const onDayClick = vi.fn();
  const onEventUpdate = vi.fn();
  const screen = await render(ui({ onEventClick, onDayClick, onEventUpdate }));
  const el = screen.container.querySelector<HTMLElement>(selector)!;

  const clickRow = () => {
    const target = row(el, screen.container);
    // Inside the row: the Gantt reads the day from the click's position.
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: target.getBoundingClientRect().left + 10 }));
  };

  await dragTo(el, position, 220, 212);
  fire(document, 'pointerup', 220, 212);
  // The click that ends the gesture itself is no click on the row or the event.
  clickRow();
  clickTarget(el).click();
  expect(onDayClick).not.toHaveBeenCalled();
  expect(onEventClick).not.toHaveBeenCalled();

  await vi.waitFor(() => expect(onEventUpdate).toHaveBeenCalledOnce());
  // Retried: that suppression lasts a moment.
  await vi.waitFor(() => {
    clickRow();
    expect(onDayClick).toHaveBeenCalled();
  });
  clickTarget(el).click();
  expect(onEventClick).toHaveBeenCalledOnce();
});

const allDayEvent: CalendarEventItem = { ...event, startAt: '2026-12-15T00:00:00.000Z', endAt: null, allDay: true };

const cellViews = [
  {
    name: 'week view',
    ui: (onEventUpdate: () => void) => (
      <CalendarEventWeekView milestones={[allDayEvent]} viewDate={date('2026-12-15')} zone={ZONE} onViewDateChange={noop}
        onEventClick={noop} onEventUpdate={onEventUpdate} brandColorMap={{}} canUpdate />
    ),
  },
  {
    name: 'month view',
    ui: (onEventUpdate: () => void) => (
      <CalendarEventMonthView milestones={[allDayEvent]} viewDate={date('2026-12-01')} zone={ZONE} onViewDateChange={noop}
        onEventClick={noop} onEventUpdate={onEventUpdate} brandColorMap={{}} canUpdate />
    ),
  },
];

/** Drags the chip over the cell of the 16th; these views have no preview to wait for. */
async function dragChipToNextDay(container: HTMLElement) {
  const chip = container.querySelector<HTMLElement>('[aria-roledescription="draggable"]')!;
  const from = chip.getBoundingClientRect();
  const day = [...container.querySelectorAll<HTMLElement>('span, div')].find(n => n.childElementCount === 0 && n.textContent === '16')!;
  const to = day.getBoundingClientRect();

  fire(chip, 'pointerdown', from.left + 2, from.top + 2);
  fire(document, 'pointermove', from.left + 12, from.top + 12);
  await settle();
  fire(document, 'pointermove', to.left + 2, to.top + 2);
  await settle();
  fire(document, 'pointermove', to.left + 3, to.top + 3);
  await settle();
  return to;
}

// Without the app's styles the week view's rows report no collision, so only the month view can
// drop here. Both go through `CalendarDndContext`, which holds the guard.
const monthView = cellViews.filter(v => v.name === 'month view');

test.each(monthView)('$name saves a chip dropped on another day', async ({ ui }) => {
  const onEventUpdate = vi.fn();
  const screen = await render(ui(onEventUpdate));

  const to = await dragChipToNextDay(screen.container);
  fire(document, 'pointerup', to.left + 3, to.top + 3);

  await vi.waitFor(() => expect(onEventUpdate).toHaveBeenCalledOnce());
  expect(onEventUpdate).toHaveBeenCalledWith('e1', expect.objectContaining({ startAt: '2026-12-16T00:00:00.000Z' }));
});

test.each(monthView)('$name saves nothing on a release after unmounting', async ({ ui }) => {
  const onEventUpdate = vi.fn();
  const screen = await render(ui(onEventUpdate));

  const to = await dragChipToNextDay(screen.container);
  await screen.unmount();
  fire(document, 'pointerup', to.left + 3, to.top + 3);

  await settle();
  expect(onEventUpdate).not.toHaveBeenCalled();
});

test.each(cellViews)('$name restores the chip on pointercancel', async ({ ui }) => {
  const screen = await render(ui(noop));

  const to = await dragChipToNextDay(screen.container);
  expect(screen.container.querySelector('.opacity-30')).not.toBeNull();
  fire(document, 'pointercancel', to.left + 3, to.top + 3);

  await vi.waitFor(() => expect(screen.container.querySelector('.opacity-30')).toBeNull());
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
