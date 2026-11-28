import { afterEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';

import { calendarDateIn } from '@luke/core';

import { idempotencyKeyOf } from '../../../../../lib/idempotencyKey';
import { ApplyTemplateDialog } from '../ApplyTemplateDialog';

/**
 * The anchor defaults to today in the profile zone, not the browser's, and only once that zone is
 * known (ADR-035); it is sent as the calendar day it shows. The two profile zones are 25 hours apart
 * (UTC+14 and UTC−11), so their dates always differ: a default taken in the browser's zone, whatever
 * it is, fails one of them.
 */

const { GROUP_ID, TEMPLATE_ID, meQuery, applyMock, templates, groups } = vi.hoisted(() => {
  const GROUP_ID = '00000000-0000-4000-8000-000000000001';
  const TEMPLATE_ID = '00000000-0000-4000-8000-000000000002';
  return {
    GROUP_ID,
    TEMPLATE_ID,
    // Read fresh by the mocked `useQuery` on every render, like the real query transitioning.
    meQuery: { data: undefined as { timezone: string } | undefined, error: null },
    applyMock: vi.fn(),
    templates: { data: [{ id: TEMPLATE_ID, name: 'Base', items: [] }], isLoading: false },
    groups: { data: [{ id: GROUP_ID, name: 'Gruppo A', isDefault: false, _count: { events: 0 } }], isLoading: false },
  };
});

vi.mock('../../../../../lib/trpc', () => ({
  trpc: {
    me: { get: { useQuery: () => meQuery } },
    seasonCalendar: {
      listTemplates: { useQuery: () => templates },
      applyTemplate: { useMutation: () => ({ mutateAsync: applyMock, isPending: false }) },
    },
    planningGroup: { list: { useQuery: () => groups } },
  },
  narrowRouterOutput: (value: unknown) => value,
}));
vi.mock('next-auth/react', () => ({ useSession: () => ({ data: { accessToken: 't' }, status: 'authenticated' }) }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

afterEach(() => {
  meQuery.data = undefined;
  applyMock.mockReset();
  groups.data[0]._count.events = 0;
});

const dialog = (open = true) => <ApplyTemplateDialog open={open} onClose={() => undefined} onApplied={() => undefined} brandId="b1" seasonId="s1" />;

test('before the profile zone has loaded, the anchor stays empty rather than taking the browser\'s day', async () => {
  const screen = await render(dialog());

  await expect.element(screen.getByLabelText('Data ancora (giorno 0)')).toHaveValue('');
});

// The group is picked before the zone arrives: filling the anchor then must not undo it.
test.each(['Pacific/Kiritimati', 'Pacific/Pago_Pago'])('anchors on today in the profile zone %s and sends that day', async timezone => {
  const before = calendarDateIn(new Date(), timezone);
  const screen = await render(dialog());
  await screen.getByRole('combobox', { name: 'Gruppo di pianificazione' }).click();
  await screen.getByRole('option', { name: 'Gruppo A' }).click();
  meQuery.data = { timezone };
  await screen.rerender(dialog());
  const after = calendarDateIn(new Date(), timezone);

  // `before`/`after` bracket the render, so a midnight crossed mid-test cannot flake it.
  const anchor = () => (screen.getByLabelText('Data ancora (giorno 0)').element() as HTMLInputElement).value;
  await expect.poll(anchor).toSatisfy(value => value === before || value === after);

  await screen.getByRole('combobox', { name: 'Template' }).click();
  await screen.getByRole('option', { name: 'Base' }).click();
  await screen.getByRole('button', { name: 'Applica' }).click();

  await vi.waitFor(() => expect(applyMock).toHaveBeenCalledTimes(1));
  expect(applyMock).toHaveBeenCalledWith({ planningGroupId: GROUP_ID, templateId: TEMPLATE_ID, anchorDate: anchor(), force: false });
  expect(idempotencyKeyOf(applyMock.mock.calls[0]?.[0])).toBeDefined();
});

/** Picks group and template and applies, the anchor already filled in the profile zone. */
async function apply(screen: Awaited<ReturnType<typeof render>>) {
  await screen.getByRole('combobox', { name: 'Gruppo di pianificazione' }).click();
  await screen.getByRole('option', { name: 'Gruppo A' }).click();
  await screen.getByRole('combobox', { name: 'Template' }).click();
  await screen.getByRole('option', { name: 'Base' }).click();
  await screen.getByRole('button', { name: 'Applica' }).click();
}

/**
 * One key per apply (#248). A lost answer leaves the group with the template's events: the group
 * list refreshes, and a retry rebuilt from it would send `force: true`, a different body for the
 * same key, which the API refuses. The retry resends the first request instead, so it replays.
 */
test('a retry after a lost answer and a refreshed group list resends the same request', async () => {
  meQuery.data = { timezone: 'Europe/Rome' };
  applyMock.mockRejectedValue(new Error('answer lost'));
  const screen = await render(dialog());
  await apply(screen);
  await vi.waitFor(() => expect(applyMock).toHaveBeenCalledTimes(1));

  groups.data[0]._count.events = 3;
  await screen.rerender(dialog());
  await screen.getByRole('button', { name: 'Applica' }).click();

  await vi.waitFor(() => expect(applyMock).toHaveBeenCalledTimes(2));
  const [first, retry] = applyMock.mock.calls.map(call => call[0]);
  expect(retry).toBe(first);
  expect(retry).toMatchObject({ force: false });
  expect(idempotencyKeyOf(retry)).toBeDefined();
});

test('the dialog stays mounted: reopening it starts a new action, with a new key', async () => {
  meQuery.data = { timezone: 'Europe/Rome' };
  applyMock.mockRejectedValue(new Error('answer lost')); // unconfirmed: only the reopening ends it
  const screen = await render(dialog());
  await apply(screen);
  await vi.waitFor(() => expect(applyMock).toHaveBeenCalledTimes(1));

  await screen.rerender(dialog(false));
  await screen.rerender(dialog());
  await apply(screen);

  await vi.waitFor(() => expect(applyMock).toHaveBeenCalledTimes(2));
  const [first, again] = applyMock.mock.calls.map(call => call[0]);
  expect(again).toEqual(first);
  expect(idempotencyKeyOf(again)).not.toBe(idempotencyKeyOf(first));
});

/**
 * A refusal is not a lost answer (#248): the group got events meanwhile, the server refused the
 * apply without `force` and stored nothing. The next click is built afresh from the refreshed list,
 * with `force` and a new key, instead of being refused again and again.
 */
test('after the server refuses, the next apply is built from the refreshed group list', async () => {
  meQuery.data = { timezone: 'Europe/Rome' };
  applyMock.mockRejectedValue({ data: { code: 'CONFLICT' }, message: 'Il gruppo di pianificazione contiene già eventi.' });
  const screen = await render(dialog());
  await apply(screen);
  await vi.waitFor(() => expect(applyMock).toHaveBeenCalledTimes(1));

  groups.data[0]._count.events = 2;
  await screen.rerender(dialog());
  await screen.getByRole('button', { name: 'Applica' }).click();

  await vi.waitFor(() => expect(applyMock).toHaveBeenCalledTimes(2));
  const [first, next] = applyMock.mock.calls.map(call => call[0]);
  expect(next).toMatchObject({ force: true });
  expect(idempotencyKeyOf(next)).not.toBe(idempotencyKeyOf(first));
});
