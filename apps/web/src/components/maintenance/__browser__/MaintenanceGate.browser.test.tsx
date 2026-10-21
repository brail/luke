import { afterEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';

import type { MaintenanceModeState } from '@luke/core';

import { MaintenanceGate } from '../MaintenanceGate';

import type { ReactNode } from 'react';

/**
 * During an active window the lock screen covers every page for whoever cannot bypass maintenance,
 * signed out included, except the two that come before a session: the login form and the password
 * reset link. Otherwise an administrator signed out during the window could not sign back in to end
 * it. The lock screen links to the login form for them.
 */

const h = vi.hoisted(() => ({ pathname: '/dashboard' }));

vi.mock('next/navigation', () => ({ usePathname: () => h.pathname }));
// `__esModule`: `next/link` is CommonJS, and once pre-bundled its default import goes through an
// interop that would otherwise hand the component this whole object.
vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => (
    <a href={href} className={className}>{children}</a>
  ),
}));
vi.mock('../../../hooks/usePermission', () => ({ usePermission: () => ({ can: () => false }) }));
vi.mock('../../../hooks/useMaintenanceStatus', () => ({
  useMaintenanceStatus: () => ({ state: ACTIVE, isLoading: false }),
}));
// Shows nothing to a viewer who cannot bypass maintenance; its mutation hooks are not under test.
vi.mock('../MaintenanceBanner', () => ({ MaintenanceBanner: () => null }));

const ACTIVE: MaintenanceModeState = {
  status: 'ACTIVE',
  scheduledAt: null,
  activatedAt: '2030-01-15T09:00:00.000Z',
  message: null,
  forceLogout: false,
  warningLeadMinutes: [],
  warningsSent: [],
  activatedByUserId: null,
  notifyByEmail: false,
};

afterEach(() => {
  h.pathname = '/dashboard';
});

test('covers an ordinary page, with a link to the login form for administrators', async () => {
  const screen = await render(<MaintenanceGate />);

  await expect.element(screen.getByRole('heading', { name: 'Sistema in manutenzione' })).toBeVisible();
  await expect.element(screen.getByRole('link', { name: 'Accesso amministratori' })).toHaveAttribute('href', '/login');
});

test.each(['/login', '/auth/reset'])('leaves %s uncovered', async pathname => {
  h.pathname = pathname;
  const screen = await render(<MaintenanceGate />);

  expect(screen.getByRole('heading', { name: 'Sistema in manutenzione' }).query()).toBeNull();
});
