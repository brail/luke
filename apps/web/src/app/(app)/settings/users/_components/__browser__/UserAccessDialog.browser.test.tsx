import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import { UserAccessDialog } from '../UserAccessDialog';

import { defaultsWith, deferred, rows, setCalls } from './sectionAccessTestKit';

/**
 * The dialog shows the overrides it read when it opened plus the administrator's edits, and a save
 * sends only those edits, on leaves the kill switch does not cover (R2c, ADR-027). Every server
 * read here is a mock: `byUserQuery` is what a cached `useQuery` would hold, `fetchByUser` what a
 * fresh read returns — the two can disagree, which is the point of several tests.
 */

const h = vi.hoisted(() => ({
  defaults: { data: undefined as unknown },
  byUserQuery: { data: [] as { section: string; enabled: boolean }[], isLoading: false },
  fetchByUser: vi.fn(),
  setMutate: vi.fn(),
  // The real `useUtils()` is one object for the component's lifetime; a new one per render would
  // look like a new dependency to every effect that reads through it.
  utils: {} as object,
}));

vi.mock('../../../../../../lib/trpc', () => ({
  trpc: {
    useUtils: () =>
      Object.assign(h.utils, {
        sectionAccess: { getByUser: { fetch: h.fetchByUser } },
      }),
    sectionAccess: {
      getByUser: { useQuery: () => h.byUserQuery },
      getDefaults: { useQuery: () => h.defaults },
      set: { useMutation: () => ({ mutateAsync: h.setMutate }) },
    },
  },
}));

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

const viewer = {
  id: 'u-viewer',
  email: 'v@example.com',
  username: 'viewer',
  firstName: 'Vera',
  lastName: 'Viewer',
  role: 'viewer' as const,
  isActive: true,
  emailVerifiedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  lastLoginAt: null,
  identities: [],
  isOnline: false,
};

const dialog = () => <UserAccessDialog user={viewer} open onOpenChange={() => undefined} />;
const sw = (screen: Awaited<ReturnType<typeof render>>, label: string) =>
  screen.getByRole('switch', { name: label, exact: true });

beforeEach(() => {
  h.defaults.data = defaultsWith();
  h.byUserQuery.data = [];
  h.fetchByUser.mockResolvedValue([]);
  h.setMutate.mockResolvedValue(null);
});

afterEach(() => {
  vi.clearAllMocks();
});

test('renders no switch before the role defaults have answered', async () => {
  h.defaults.data = undefined;
  const screen = await render(dialog());

  await expect.element(screen.getByRole('heading', { name: 'Visibilità sezioni' })).toBeInTheDocument();
  expect(screen.getByRole('switch').elements()).toHaveLength(0);
});

test('a refetch bringing an override on a killed leaf does not make the save delete it', async () => {
  h.defaults.data = defaultsWith(['admin.brands']);
  const screen = await render(dialog());
  await expect.element(sw(screen, '↳ Stagioni')).toBeEnabled();

  // Someone stored `admin.brands` meanwhile; the query cache now holds it.
  h.byUserQuery.data = rows({ 'admin.brands': true });
  h.fetchByUser.mockResolvedValue(rows({ 'admin.brands': true, 'admin.seasons': true }));
  await sw(screen, '↳ Stagioni').click();
  await screen.getByRole('button', { name: 'Salva' }).click();

  await expect.poll(() => setCalls(h.setMutate)).toEqual([['admin.seasons', true]]);
});

test('a refetch bringing another administrator\'s change on an untouched leaf does not revert it', async () => {
  const screen = await render(dialog());
  await expect.element(sw(screen, '↳ Stagioni')).toBeEnabled();

  h.byUserQuery.data = rows({ 'admin.vendors': true });
  h.fetchByUser.mockResolvedValue(rows({ 'admin.vendors': true, 'admin.seasons': true }));
  await sw(screen, '↳ Stagioni').click();
  await screen.getByRole('button', { name: 'Salva' }).click();

  await expect.poll(() => setCalls(h.setMutate)).toEqual([['admin.seasons', true]]);
});

test('an edit on a leaf the kill switch covers since is not sent', async () => {
  const screen = await render(dialog());
  await sw(screen, '↳ Stagioni').click();
  await sw(screen, '↳ Fornitori').click();

  h.defaults.data = defaultsWith(['admin.seasons']);
  await screen.rerender(dialog());
  await expect.element(sw(screen, '↳ Stagioni')).toBeDisabled();
  await screen.getByRole('button', { name: 'Salva' }).click();

  await expect.poll(() => setCalls(h.setMutate)).toEqual([['admin.vendors', true]]);
});

test('a failed save keeps the edit and the retry never sends a leaf another administrator changed', async () => {
  const screen = await render(dialog());
  await sw(screen, '↳ Stagioni').click();

  h.setMutate.mockRejectedValueOnce(new Error('rate limited'));
  h.fetchByUser.mockResolvedValue(rows({ 'admin.vendors': true })); // B, added by someone else
  h.byUserQuery.data = rows({ 'admin.vendors': true });
  await screen.getByRole('button', { name: 'Salva' }).click();
  await expect.poll(() => h.setMutate.mock.calls.length).toBe(1);
  await expect.element(sw(screen, '↳ Fornitori')).toBeChecked();

  await screen.getByRole('button', { name: 'Salva' }).click();
  await expect.poll(() => setCalls(h.setMutate)).toEqual([
    ['admin.seasons', true],
    ['admin.seasons', true],
  ]);
});

test('a call that committed but answered with an error leaves nothing to send', async () => {
  const screen = await render(dialog());
  await sw(screen, '↳ Stagioni').click();

  h.setMutate.mockRejectedValueOnce(new Error('connection reset'));
  h.fetchByUser.mockResolvedValue(rows({ 'admin.seasons': true }));
  await screen.getByRole('button', { name: 'Salva' }).click();

  await expect.element(sw(screen, '↳ Stagioni')).toBeChecked();
  await expect.element(screen.getByRole('button', { name: 'Salva' })).toBeDisabled();
});

test('a failed reconciliation read disables saving', async () => {
  const screen = await render(dialog());
  await sw(screen, '↳ Stagioni').click();

  h.setMutate.mockRejectedValueOnce(new Error('rate limited'));
  h.fetchByUser.mockRejectedValue(new Error('network down'));
  await screen.getByRole('button', { name: 'Salva' }).click();

  await expect.element(screen.getByText(/chiudi e riapri/)).toBeInTheDocument();
  await expect.element(screen.getByRole('button', { name: 'Salva' })).toBeDisabled();
});

test('nothing is editable, and Escape does not close, while a save is in flight', async () => {
  const onOpenChange = vi.fn();
  const screen = await render(<UserAccessDialog user={viewer} open onOpenChange={onOpenChange} />);
  await sw(screen, '↳ Stagioni').click();

  const inFlight = deferred<null>();
  h.setMutate.mockReturnValueOnce(inFlight.promise);
  await screen.getByRole('button', { name: 'Salva' }).click();

  await expect.element(sw(screen, '↳ Stagioni')).toBeDisabled();
  await expect.element(screen.getByRole('button', { name: 'Annulla' })).toBeDisabled();
  await userEvent.keyboard('{Escape}');
  expect(onOpenChange).not.toHaveBeenCalled();
  inFlight.resolve(null);
});

test('reopening with a cached answer but a failing fresh read shows no switch', async () => {
  h.byUserQuery.data = rows({ 'admin.seasons': true });
  h.fetchByUser.mockRejectedValue(new Error('network down'));
  const screen = await render(dialog());

  await expect.element(screen.getByText(/chiudi e riapri/)).toBeInTheDocument();
  expect(screen.getByRole('switch').elements()).toHaveLength(0);
});
