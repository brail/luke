import { TRPCClientError } from '@trpc/client';
import { afterEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';

import { getTrpcErrorMessage } from '../../lib/trpcErrorMessages';
import { ProfileLoadAlert } from '../ProfileLoadAlert';
import { expectSubmitsSignOut } from '../system/__browser__/expectSubmitsSignOut';

/**
 * When the profile cannot load, the shell says what failed, that dates stay hidden, when a retry
 * makes sense, and keeps `Esci` at hand (#239); a 429 is retried only after the server's wait.
 */

const { profile, refetch } = vi.hoisted(() => ({
  profile: { error: null as unknown },
  refetch: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../hooks/useFormatDate', () => ({ useFormatDate: () => ({ error: profile.error }) }));
vi.mock('../../lib/trpc', () => ({ trpc: { useUtils: () => ({ me: { get: { refetch } } }) } }));

/** A failed tRPC call as the link reports it: `data` is the error's `data` from the API. */
const trpcFailure = (data: Record<string, unknown>) =>
  new TRPCClientError('failed', { result: { error: { message: 'failed', code: -32000, data } } });

/** A 429 whose server wait is one second; a new object each call, as each refusal is. */
const tooManyRequests = () => trpcFailure({ code: 'TOO_MANY_REQUESTS', httpStatus: 429, retryAfterSeconds: 1 });

afterEach(() => {
  profile.error = null;
  refetch.mockClear();
});

test('a loaded profile shows nothing', async () => {
  const screen = await render(<ProfileLoadAlert />);

  await expect.element(screen.getByRole('alert')).not.toBeInTheDocument();
});

test('a session that ended shows nothing: the browser is signing out', async () => {
  profile.error = trpcFailure({ code: 'UNAUTHORIZED', httpStatus: 401, sessionEnded: true });
  const screen = await render(<ProfileLoadAlert />);

  await expect.element(screen.getByRole('alert')).not.toBeInTheDocument();
});

test("a 429 says so and enables Riprova only after the server's wait", async () => {
  profile.error = tooManyRequests();
  const screen = await render(<ProfileLoadAlert />);

  await expect.element(screen.getByText('Profilo non caricato')).toBeVisible();
  await expect.element(screen.getByText('Troppe richieste in poco tempo.')).toBeVisible();
  await expect.element(screen.getByText('Date e orari restano nascosti finché il profilo non è caricato.')).toBeVisible();
  await expect.element(screen.getByText('Puoi riprovare tra circa 1 secondo.')).toBeVisible();
  const retry = screen.getByRole('button', { name: 'Riprova' });
  await expect.element(retry).toBeDisabled();

  await expect.element(retry, { timeout: 2000 }).toBeEnabled();
  await expect.element(screen.getByText('Puoi riprovare tra circa 1 secondo.')).not.toBeInTheDocument();
  await retry.click();
  expect(refetch).toHaveBeenCalledTimes(1);
});

test('a new 429 after the wait disables Riprova again for its own wait', async () => {
  profile.error = tooManyRequests();
  const screen = await render(<ProfileLoadAlert />);
  const retry = screen.getByRole('button', { name: 'Riprova' });
  await expect.element(retry, { timeout: 2000 }).toBeEnabled();

  profile.error = tooManyRequests();
  await screen.rerender(<ProfileLoadAlert />);

  await expect.element(retry).toBeDisabled();
  await expect.element(screen.getByText('Puoi riprovare tra circa 1 secondo.')).toBeVisible();
  await expect.element(retry, { timeout: 2000 }).toBeEnabled();
});

test('while a retry is in flight the button waits for it', async () => {
  profile.error = new TRPCClientError('Failed to fetch');
  let release = () => {};
  refetch.mockImplementationOnce(() => new Promise<void>(resolve => (release = resolve)));
  const screen = await render(<ProfileLoadAlert />);

  await screen.getByRole('button', { name: 'Riprova' }).click();
  await expect.element(screen.getByRole('button', { name: 'Riprovo…' })).toBeDisabled();
  expect(refetch).toHaveBeenCalledTimes(1);

  release();
  await expect.element(screen.getByRole('button', { name: 'Riprova' })).toBeEnabled();
});

test('a network failure points at the connection, and Riprova refetches at once', async () => {
  profile.error = new TRPCClientError('Failed to fetch');
  const screen = await render(<ProfileLoadAlert />);

  await expect.element(screen.getByText('Il server non risponde: controlla la connessione.')).toBeVisible();
  await screen.getByRole('button', { name: 'Riprova' }).click();
  expect(refetch).toHaveBeenCalledTimes(1);
});

test("any other failure shows the error's own message", async () => {
  profile.error = trpcFailure({ code: 'INTERNAL_SERVER_ERROR', httpStatus: 500 });
  const screen = await render(<ProfileLoadAlert />);

  await expect.element(screen.getByText(getTrpcErrorMessage(profile.error))).toBeVisible();
  await expect.element(screen.getByRole('button', { name: 'Riprova' })).toBeEnabled();
});

test('Esci posts the sign-out form', async () => {
  profile.error = new TRPCClientError('Failed to fetch');
  const screen = await render(<ProfileLoadAlert />);

  await expectSubmitsSignOut(screen.getByRole('button', { name: 'Esci' }));
});
