import { afterEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';

import { calendarDateIn } from '@luke/core';

import { SendDigestDialog } from '../SendDigestDialog';

/**
 * The server reads a manual digest range in the caller's zone as `me.get` resolves it, so the
 * dialog's default "today" must be taken in that zone — not the browser's, and not a provisional
 * one before `me.get` has answered.
 *
 * The two profile zones are 25 hours apart (UTC+14 and UTC−11), so their calendar dates always
 * differ: a default taken in the browser's zone, whatever it is, fails one of them.
 */

const { meQuery, mutateMock } = vi.hoisted(() => ({
  // Read fresh by the mocked `useQuery` on every render, like the real query transitioning.
  meQuery: { data: undefined as { timezone: string } | undefined },
  mutateMock: vi.fn(),
}));

vi.mock('../../../../../lib/trpc', () => ({
  trpc: {
    me: { get: { useQuery: () => meQuery } },
    system: { triggerCalendarDigest: { useMutation: () => ({ mutate: mutateMock, isPending: false }) } },
  },
}));

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

afterEach(() => {
  meQuery.data = undefined;
  mutateMock.mockReset();
});

test('before the profile zone has loaded, the fields stay empty and sending is disabled', async () => {
  const screen = await render(<SendDigestDialog open onClose={() => undefined} />);

  await expect.element(screen.getByLabelText('Dal', { exact: true })).toHaveValue('');
  await expect.element(screen.getByLabelText('Al', { exact: true })).toHaveValue('');
  await expect.element(screen.getByRole('button', { name: 'Invia' })).toBeDisabled();
});

test.each(['Pacific/Kiritimati', 'Pacific/Pago_Pago'])('defaults to today in the profile zone %s once it loads', async timezone => {
  const before = calendarDateIn(new Date(), timezone);
  const screen = await render(<SendDigestDialog open onClose={() => undefined} />);

  meQuery.data = { timezone };
  await screen.rerender(<SendDigestDialog open onClose={() => undefined} />);
  const after = calendarDateIn(new Date(), timezone);

  // `before`/`after` bracket the render, so a midnight crossed mid-test cannot flake it.
  // The locator targets an `<input type="date">`, whose value is the `YYYY-MM-DD` string.
  const from = () => (screen.getByLabelText('Dal', { exact: true }).element() as HTMLInputElement).value;
  await expect.poll(from).toSatisfy(value => value === before || value === after);
  await screen.getByRole('button', { name: 'Invia' }).click();
  await expect.poll(() => mutateMock.mock.calls.length).toBe(1);

  // The mutation receives the schema's output, the two calendar dates.
  const sent = mutateMock.mock.calls[0]?.[0] as { from: string; to: string } | undefined;
  expect([before, after]).toContain(sent?.from);
  expect(sent?.to).toBe(sent?.from);
});
