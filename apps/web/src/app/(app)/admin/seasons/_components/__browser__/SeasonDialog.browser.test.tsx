import { expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';

import { SeasonDialog } from '../SeasonDialog';

/**
 * The season dialog loads the NAV seasons only for its link picker, which only whoever can create
 * or edit a season uses.
 */

const h = vi.hoisted((): { held: Set<string>; navEnabled: unknown } => ({ held: new Set(), navEnabled: undefined }));

vi.mock('../../../../../../hooks/usePermission', () => ({
  usePermission: () => ({ can: (permission: string) => h.held.has(permission) }),
}));
vi.mock('../../../../../../lib/trpc', () => ({
  trpc: {
    integrations: {
      nav: {
        seasons: {
          list: {
            useQuery: (_input: unknown, options?: { enabled?: boolean }) => {
              h.navEnabled = options?.enabled;
              return { data: [] };
            },
          },
        },
      },
    },
  },
}));

test.each([
  ['read only', ['seasons:read'], false],
  ['create alone', ['seasons:read', 'seasons:create'], true],
  ['update alone', ['seasons:read', 'seasons:update'], true],
] as const)('the NAV link picker loads its list with %s: %s', async (_name, held, enabled) => {
  h.held = new Set(held);
  h.navEnabled = undefined;
  const screen = await render(<SeasonDialog open onOpenChange={vi.fn()} onSubmit={vi.fn()} isLoading={false} />);
  await expect.element(screen.getByRole('dialog')).toBeVisible();
  expect(h.navEnabled).toBe(enabled);
});
