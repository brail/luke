import { afterEach, expect, test, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import { TimezoneUpdateDialog } from '../TimezoneUpdateDialog';

/**
 * The dialog proposes the browser zone when the profile names another zone — not another spelling
 * of the same one. Chromium reports Kolkata as `Asia/Calcutta`, so a profile saved as
 * `Asia/Kolkata` must not be prompted every session.
 */

const BROWSER_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;
const h = vi.hoisted(() => ({ profileZone: 'Pacific/Chatham' }));

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { accessToken: 't', user: { id: 'u1' } }, status: 'authenticated' }),
}));
vi.mock('../../lib/trpc', () => ({
  trpc: {
    me: {
      get: { useQuery: () => ({ data: { timezone: h.profileZone }, error: null }) },
      updateTimezone: { useMutation: () => ({ mutateAsync: vi.fn() }) },
    },
  },
}));
vi.mock('../../lib/refresh', () => ({ useRefresh: () => ({ timeZone: vi.fn() }) }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

afterEach(() => {
  h.profileZone = 'Pacific/Chatham';
});

test(`a profile in another zone is offered ${BROWSER_ZONE}`, async () => {
  const screen = await render(<TimezoneUpdateDialog />);

  await expect.element(screen.getByText(BROWSER_ZONE, { exact: false }).first(), { timeout: 4000 }).toBeVisible();
});

test('once closed, the dialog stays closed', async () => {
  const screen = await render(<TimezoneUpdateDialog />);
  await expect.element(screen.getByRole('dialog'), { timeout: 4000 }).toBeVisible();

  await userEvent.keyboard('{Escape}');
  await new Promise(resolve => setTimeout(resolve, 2500));
  expect(screen.getByRole('dialog').elements()).toHaveLength(0);
});

test.runIf(['Asia/Calcutta', 'Asia/Kolkata'].includes(BROWSER_ZONE))('a profile saved under an alias of the browser zone is not prompted', async () => {
  h.profileZone = BROWSER_ZONE === 'Asia/Calcutta' ? 'Asia/Kolkata' : 'Asia/Calcutta';
  const screen = await render(<TimezoneUpdateDialog />);

  await new Promise(resolve => setTimeout(resolve, 2500));
  expect(screen.getByRole('dialog').elements()).toHaveLength(0);
});
