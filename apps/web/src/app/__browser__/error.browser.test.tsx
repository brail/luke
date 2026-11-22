import { expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';

import { expectSubmitsSignOut } from '../../components/system/__browser__/expectSubmitsSignOut';
import AppError from '../error';

/**
 * The boundary's retry must be `retry`, which fetches the segment again: `reset` alone re-renders
 * what the server already answered, so a failed section access check would never be repeated.
 * It also catches a failed `(app)` layout, where no sidebar is left: `Esci` is the way out (#238).
 */

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('../../components/system/ReportIssueButton', () => ({ ReportIssueButton: () => null }));

test('Riprova asks for the segment again', async () => {
  const retry = vi.fn();

  const screen = await render(<AppError error={new Error('failed')} retry={retry} />);
  await screen.getByRole('button', { name: 'Riprova' }).click();

  expect(retry).toHaveBeenCalledTimes(1);
});

test('Esci posts the sign-out form', async () => {
  const screen = await render(<AppError error={new Error('failed')} retry={vi.fn()} />);

  await expectSubmitsSignOut(screen.getByRole('button', { name: 'Esci' }));
});
