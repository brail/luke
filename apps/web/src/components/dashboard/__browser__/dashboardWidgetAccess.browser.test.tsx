import { beforeEach, describe, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';

import { DashboardGrid } from '../DashboardGrid';

/**
 * A home widget shows only to a user who can see its section and holds the section's permission
 * (#217): a viewer, whose sales section is off, sees no weekly orders. Each condition is checked
 * alone, in the grid and in the customize sheet; a widget not shown fires no query.
 */

const h = vi.hoisted(() => ({
  sections: {} as Record<string, boolean>,
  permissions: [] as string[],
  weeklySalesRendered: vi.fn(),
}));

vi.mock('next-auth/react', () => ({ useSession: () => ({ data: { user: { firstName: 'Luca' } } }) }));
vi.mock('../../../hooks/useFormatDate', () => ({ useFormatDate: () => ({ zone: null, today: null }) }));
vi.mock('../../../hooks/useSectionAccess', () => ({ useSectionAccess: () => h.sections }));
vi.mock('../../../hooks/usePermission', () => ({
  usePermission: () => ({ can: (permission: string) => h.permissions.includes(permission) }),
}));
vi.mock('../../../lib/trpc', () => ({
  trpc: {
    useUtils: () => ({ dashboard: { getConfig: { invalidate: vi.fn() } } }),
    dashboard: {
      getConfig: { useQuery: () => ({ data: { widgets: [] }, isLoading: false }) },
      saveConfig: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
  },
}));
// The widgets themselves are stubs: what is under test is which ones the grid mounts.
vi.mock('../widgets/WeeklySalesWidget', () => ({
  WeeklySalesWidget: () => {
    h.weeklySalesRendered();
    return <p>weekly-sales-widget</p>;
  },
}));
vi.mock('../widgets/KpiStatsWidget', () => ({ KpiStatsWidget: () => null }));
vi.mock('../widgets/SeasonProgressWidget', () => ({ SeasonProgressWidget: () => null }));
vi.mock('../widgets/TasksWidget', () => ({ TasksWidget: () => null }));
vi.mock('../widgets/ForexWidget', () => ({ ForexWidget: () => null }));
vi.mock('../widgets/ClocksWidget', () => ({ ClocksWidget: () => null }));

beforeEach(() => vi.clearAllMocks());

async function renderFor(sections: Record<string, boolean>, permissions: string[]) {
  h.sections = sections;
  h.permissions = permissions;
  const screen = await render(<DashboardGrid />);
  await screen.getByTitle('Personalizza dashboard').click();
  await expect.element(screen.getByText('Personalizza dashboard', { exact: true })).toBeVisible();
  return screen;
}

describe('the weekly orders widget', () => {
  test.each([
    ['the section off, the permission held', { 'sales.statistics': false }, ['sales:read']],
    ['the section on, the permission missing', { 'sales.statistics': true }, []],
    ['section access not loaded yet', {}, ['sales:read']],
  ])('is neither shown nor offered with %s', async (_case, sections, permissions) => {
    const screen = await renderFor(sections, permissions);

    expect(screen.getByText('weekly-sales-widget').elements()).toHaveLength(0);
    expect(screen.getByText('Ordini settimanali').elements()).toHaveLength(0);
    expect(h.weeklySalesRendered).not.toHaveBeenCalled();
  });

  test('is shown and offered with the section on and the permission held', async () => {
    const screen = await renderFor({ 'sales.statistics': true }, ['sales:read']);

    await expect.element(screen.getByText('weekly-sales-widget')).toBeVisible();
    await expect.element(screen.getByText('Ordini settimanali')).toBeVisible();
  });
});
