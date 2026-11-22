import { test, vi } from 'vitest';
import { render } from 'vitest-browser-react';

import { expectSubmitsSignOut } from '../../components/system/__browser__/expectSubmitsSignOut';
import NotFound from '../not-found';

import type { ReactNode } from 'react';

/** The 404 page has no sidebar: `Esci` is its way out (#238). */

// `__esModule`: `next/link` is CommonJS, and once pre-bundled its default import goes through an
// interop that would otherwise hand the page this whole object as the component.
vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));
vi.mock('../../components/system/ReportIssueButton', () => ({ ReportIssueButton: () => null }));

test('Esci posts the sign-out form', async () => {
  const screen = await render(<NotFound />);

  await expectSubmitsSignOut(screen.getByRole('button', { name: 'Esci' }));
});
