import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import { TooltipProvider } from '../../../../../../components/ui/tooltip';
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

// The app mounts TooltipProvider once (components/Providers.tsx); the section switches' PermissionTooltip needs it.
const dialog = (onOpenChange: (open: boolean) => void = () => undefined) => (
  <TooltipProvider delayDuration={0}>
    <UserAccessDialog user={viewer} open onOpenChange={onOpenChange} />
  </TooltipProvider>
);
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
  const screen = await render(dialog(onOpenChange));
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

// ADR-043 (#262): a leaf turns on only for a role holding its permission. The viewer here holds
// `brands:read`/`seasons:read`, not `config:read` (the LDAP settings leaf).
test('a leaf the role cannot read is off and unavailable, with the permission named', async () => {
  const screen = await render(dialog());

  await expect.element(sw(screen, '↳ Auth LDAP')).toBeDisabled();
  await userEvent.hover(sw(screen, '↳ Auth LDAP').element().parentElement!);
  await expect
    .element(screen.getByText('Richiede il permesso config:read, che il ruolo viewer non ha').first())
    .toBeInTheDocument();
});

test('a stored override the role cannot read is shown as such and can be turned off', async () => {
  h.byUserQuery.data = rows({ 'settings.ldap': true });
  h.fetchByUser.mockResolvedValue(rows({ 'settings.ldap': true }));
  const screen = await render(dialog());

  await expect.element(screen.getByText('(permesso mancante: config:read)')).toBeInTheDocument();
  await expect.element(sw(screen, '↳ Auth LDAP')).toBeEnabled();
  await sw(screen, '↳ Auth LDAP').click();
  await screen.getByRole('button', { name: 'Salva' }).click();

  await expect.poll(() => setCalls(h.setMutate)).toEqual([['settings.ldap', null]]);
});

// L19 (#265): a reset to auto is never refused, so on a leaf whose stored role default is itself a
// violation it brings the section back on. The dialog shows that outcome before anything is sent.
test('a reset onto a violating role default shows the leaf on with its missing permission before Save', async () => {
  const defaults = defaultsWith();
  defaults.sectionAccessDefaults.viewer['settings.ldap'] = 'enabled';
  h.defaults.data = defaults;
  h.byUserQuery.data = rows({ 'settings.ldap': false });
  h.fetchByUser.mockResolvedValue(rows({ 'settings.ldap': false }));
  const screen = await render(dialog());

  await expect.element(sw(screen, '↳ Auth LDAP')).not.toBeChecked();
  // The leaf's own Reset, next to its switch (the parent row has one too).
  const leafControls = sw(screen, '↳ Auth LDAP').element().closest('div')!; // Past the tooltip's span.
  const reset = [...leafControls.querySelectorAll('button')].find(button => button.textContent === 'Reset');
  expect(reset, "the leaf's own Reset button").toBeDefined();
  await userEvent.click(reset!);

  await expect.element(sw(screen, '↳ Auth LDAP')).toBeChecked();
  await expect.element(screen.getByText('(permesso mancante: config:read)')).toBeInTheDocument();
  expect(h.setMutate).not.toHaveBeenCalled();
  // Still switchable, so the administrator can turn it off again before saving.
  await expect.element(sw(screen, '↳ Auth LDAP')).toBeEnabled();
});

test('a refused save says why, with the server message', async () => {
  const { toast } = await import('sonner');
  h.setMutate.mockRejectedValueOnce(new Error('La sezione admin.seasons richiede il permesso seasons:read, che il ruolo viewer non ha.'));
  const screen = await render(dialog());
  await sw(screen, '↳ Stagioni').click();
  await screen.getByRole('button', { name: 'Salva' }).click();

  await expect.poll(() => vi.mocked(toast.error).mock.calls.at(-1)?.[0]).toContain('seasons:read');
});
