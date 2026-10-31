import { afterEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';

import { FreezePlanningGroupWizard } from '../FreezePlanningGroupWizard';

/**
 * A freeze covers every event of the group, also those outside the user's functions (ADR-040): the
 * warning gives how many of those land on a non-working day, and names none of them.
 */

const h = vi.hoisted(() => ({ overlaps: { entries: [] as unknown[], hiddenCount: 0 } }));

vi.mock('../../../../../lib/trpc', () => ({
  trpc: {
    useUtils: () => ({ planningGroup: { list: { invalidate: vi.fn() } } }),
    seasonCalendar: {
      holidayOverlapsForGroup: { useQuery: () => ({ data: h.overlaps }) },
      freezePlanningGroup: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
  },
}));

const wizard = () => (
  <FreezePlanningGroupWizard
    open
    onClose={() => undefined}
    onFrozen={() => undefined}
    planningGroupId="00000000-0000-4000-8000-000000000001"
    zone="Europe/Rome"
    milestones={[]}
  />
);

afterEach(() => {
  h.overlaps = { entries: [], hiddenCount: 0 };
});

test('says how many events outside the user\'s functions land on a non-working day', async () => {
  h.overlaps = { entries: [], hiddenCount: 2 };

  const screen = await render(wizard());

  await expect.element(screen.getByText(/2 eventi fuori dalle tue funzioni cadono/)).toBeVisible();
});

test('uses the singular for one', async () => {
  h.overlaps = { entries: [], hiddenCount: 1 };

  const screen = await render(wizard());

  await expect.element(screen.getByText(/1 evento fuori dalle tue funzioni cade/)).toBeVisible();
});

test('has no warning about them when there are none', async () => {
  const screen = await render(wizard());

  await expect.element(screen.getByRole('heading', { name: 'Congela pianificazione' })).toBeVisible();
  expect(screen.getByText(/cadono|cade su/).elements()).toHaveLength(0);
});
