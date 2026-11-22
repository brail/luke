import { beforeEach, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import AppSidebar from '../AppSidebar';
import { expectSubmitsSignOut } from '../system/__browser__/expectSubmitsSignOut';
import { SidebarProvider } from '../ui/sidebar';

/**
 * The sidebar's `Esci` is the one sign-out path (#238, ADR-048): a native form post, which the
 * server completes whatever the API answers. The menu stays open on select, or closing it would
 * unmount the form before the browser submits it.
 */

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { firstName: 'Ada', lastName: 'Rossi' } }, status: 'authenticated' }),
}));
vi.mock('next/navigation', () => ({ usePathname: () => '/dashboard' }));
vi.mock('../../hooks/useMenuAccess', () => ({ useMenuAccess: () => ({ showSystemSection: false }) }));
vi.mock('../../hooks/useMenuPreferences', () => ({
  useMenuPreferences: () => ({ menuStates: {}, toggleMenu: vi.fn() }),
}));
vi.mock('../FeedbackDialog', () => ({ FeedbackDialog: () => null }));

// A desktop width: below 768 px the sidebar is a closed sheet.
beforeEach(() => page.viewport(1280, 800));

async function openUserMenu() {
  const screen = await render(
    <SidebarProvider>
      <AppSidebar />
    </SidebarProvider>
  );
  await screen.getByText('Ada Rossi').click();
  return screen.getByRole('menuitem', { name: 'Esci' });
}

test('a click on Esci posts the sign-out form', async () => {
  await expectSubmitsSignOut(await openUserMenu());
});

test('Enter on Esci posts the sign-out form', async () => {
  const item = await openUserMenu();

  await expectSubmitsSignOut(item, async () => {
    (item.element() as HTMLElement).focus();
    await userEvent.keyboard('{Enter}');
  });
});
