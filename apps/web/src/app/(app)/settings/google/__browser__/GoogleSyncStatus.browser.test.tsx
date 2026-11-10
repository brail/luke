import { expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';

import { GoogleSyncStatus } from '../GoogleSyncStatus';

/**
 * Settings → Google shows each Google Calendar operation's last success and last failure (#223), the
 * error in full, and never reads a later success as clearing an earlier failure.
 */

// The times are written in the profile zone, which `useFormatDate` reads through tRPC.
vi.mock('../../../../../hooks/useFormatDate', () => ({
  useFormatDate: () => ({ dateTime: (value: string) => `[${value}]` }),
}));

// The API answers in JSON: instants arrive as ISO strings.
const NINE = '2026-11-10T09:00:00.000Z';
const TEN = '2026-11-10T10:00:00.000Z';
const ERROR = 'unauthorized_client: Client is unauthorized to retrieve access tokens using this method.';

test('a success only: its time and no error', async () => {
  const screen = await render(
    <GoogleSyncStatus operations={[{ operation: 'events', lastSuccessAt: NINE, lastErrorAt: null, lastError: null }]} />
  );

  await expect.element(screen.getByText('Sincronizzazione eventi')).toBeVisible();
  await expect.element(screen.getByText(`Ultimo successo: [${NINE}]`)).toBeVisible();
  await expect.element(screen.getByText('Ultimo errore: —')).toBeVisible();
});

test.each([
  ['an error after a success', NINE, TEN, true],
  ['a success after an error', TEN, NINE, false],
])('%s: both times and the error in full', async (_label, lastSuccessAt, lastErrorAt, red) => {
  const screen = await render(
    <GoogleSyncStatus operations={[{ operation: 'readers', lastSuccessAt, lastErrorAt, lastError: ERROR }]} />
  );

  await expect.element(screen.getByText('Lettori dei calendari')).toBeVisible();
  await expect.element(screen.getByText(`Ultimo successo: [${lastSuccessAt}]`)).toBeVisible();
  await expect.element(screen.getByText(`Ultimo errore: [${lastErrorAt}]`)).toBeVisible();
  await expect.element(screen.getByText(ERROR)).toBeVisible();
  // Muted, not cleared, once the operation has succeeded since.
  if (red) await expect.element(screen.getByText(ERROR)).toHaveClass('text-status-critical');
  else await expect.element(screen.getByText(ERROR)).not.toHaveClass('text-status-critical');
});

test('nothing without an outcome', async () => {
  const screen = await render(<GoogleSyncStatus operations={[]} />);

  expect(screen.container.textContent).toBe('');
});
