import { afterEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';

import { calendarDateIn } from '@luke/core';

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
      applyTemplate: { useMutation: () => ({ mutate: applyMock, isPending: false }) },
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
});

const dialog = () => <ApplyTemplateDialog open onClose={() => undefined} onApplied={() => undefined} brandId="b1" seasonId="s1" />;

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
});
