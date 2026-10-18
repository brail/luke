import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';

import { ApproveUserDialog } from '../ApproveUserDialog';

import { defaultsWith, deferred, rows, setCalls } from './sectionAccessTestKit';

/**
 * An approval attempt is the role (if the administrator changed it), the override edits, then the
 * approval. After any failure the dialog re-reads the stored role, the pending status and the
 * overrides before another attempt (R2c, ADR-027). `fetchPending` and `fetchByUser` are those reads.
 */

const h = vi.hoisted(() => ({
  defaults: { data: undefined as unknown },
  fetchByUser: vi.fn(),
  fetchPending: vi.fn(),
  setMutate: vi.fn(),
  updateMutate: vi.fn(),
  approveMutate: vi.fn(),
  /** `*:*` held or not: whether the dialog configures role and sections, or only approves. */
  admin: { value: true },
  // The real `useUtils()` is one object for the component's lifetime (see UserAccessDialog's test).
  utils: {} as object,
}));

vi.mock('../../../../../../lib/trpc', () => ({
  trpc: {
    useUtils: () =>
      Object.assign(h.utils, {
        sectionAccess: { getByUser: { fetch: h.fetchByUser } },
        users: { listPending: { fetch: h.fetchPending } },
      }),
    sectionAccess: {
      getDefaults: { useQuery: () => h.defaults },
      set: { useMutation: () => ({ mutateAsync: h.setMutate }) },
    },
    users: {
      update: { useMutation: () => ({ mutateAsync: h.updateMutate }) },
      approvePending: { useMutation: () => ({ mutateAsync: h.approveMutate }) },
    },
    company: {
      function: { list: { useQuery: () => ({ data: [{ id: 'f1', name: 'Design' }] }) } },
      team: {
        listByFunction: {
          useQuery: () => ({ data: [{ id: 't1', name: 'Team A', brandScopes: [] }] }),
        },
      },
    },
  },
}));

vi.mock('../../../../../../hooks/usePermission', () => ({
  usePermission: () => ({ can: (permission: string) => permission !== '*:*' || h.admin.value }),
}));

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

const pendingViewer = { id: 'u-p', username: 'newbie', firstName: 'New', lastName: 'Bie', role: 'viewer' as const };
const pendingAs = (role: string) => ({ users: [{ ...pendingViewer, role }], total: 1 });

type Screen = Awaited<ReturnType<typeof render>>;
const sw = (screen: Screen, label: string) => screen.getByRole('switch', { name: label, exact: true });
const approveButton = (screen: Screen) => screen.getByRole('button', { name: 'Salva e approva' });

async function chooseTeam(screen: Screen) {
  await screen.getByRole('combobox').nth(1).click();
  await screen.getByRole('option', { name: 'Design' }).click();
  await screen.getByRole('combobox').nth(2).click();
  await screen.getByRole('option', { name: 'Team A' }).click();
}

async function chooseRole(screen: Screen, label: 'Viewer' | 'Editor' | 'Admin') {
  await screen.getByRole('combobox').nth(0).click();
  await screen.getByRole('option', { name: label }).click();
}

function dialog(onApproved = vi.fn()) {
  return <ApproveUserDialog user={pendingViewer} open onOpenChange={() => undefined} onApproved={onApproved} />;
}

beforeEach(() => {
  h.admin.value = true;
  h.defaults.data = defaultsWith();
  h.fetchByUser.mockResolvedValue([]);
  h.fetchPending.mockResolvedValue(pendingAs('viewer'));
  h.setMutate.mockResolvedValue(null);
  h.updateMutate.mockResolvedValue({});
  h.approveMutate.mockResolvedValue({ success: true });
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

test('after a failed approval, a role change removes the overrides already saved, not the killed ones', async () => {
  h.defaults.data = defaultsWith(['admin.brands']);
  h.fetchByUser.mockResolvedValue(rows({ 'admin.brands': true }));
  const screen = await render(dialog());
  await sw(screen, '↳ Stagioni').click();
  await chooseTeam(screen);

  h.approveMutate.mockRejectedValueOnce(new Error('approval failed'));
  h.fetchByUser.mockResolvedValue(rows({ 'admin.brands': true, 'admin.seasons': true }));
  await approveButton(screen).click();
  await expect.poll(() => h.approveMutate.mock.calls.length).toBe(1);
  await expect.element(approveButton(screen)).toBeEnabled();

  await chooseRole(screen, 'Editor');
  await approveButton(screen).click();

  await expect.poll(() => h.approveMutate.mock.calls.length).toBe(2);
  expect(setCalls(h.setMutate)).toEqual([
    ['admin.seasons', true],
    ['admin.seasons', null],
  ]);
  expect(h.updateMutate).toHaveBeenCalledWith({ id: 'u-p', role: 'editor' });
});

test('a role update that committed but answered with an error is not skipped when the role is switched back', async () => {
  const screen = await render(dialog());
  await chooseRole(screen, 'Editor');
  await chooseTeam(screen);

  h.updateMutate.mockRejectedValueOnce(new Error('connection reset'));
  h.fetchPending.mockResolvedValue(pendingAs('editor')); // it committed
  await approveButton(screen).click();
  await expect.poll(() => h.fetchPending.mock.calls.length).toBe(2);
  await expect.element(approveButton(screen)).toBeEnabled();

  await chooseRole(screen, 'Viewer');
  await approveButton(screen).click();

  await expect.poll(() => h.approveMutate.mock.calls.length).toBe(1);
  expect(h.updateMutate).toHaveBeenLastCalledWith({ id: 'u-p', role: 'viewer' });
});

test('an approval that committed but answered with an error ends the dialog without a second approval', async () => {
  const onApproved = vi.fn();
  const screen = await render(dialog(onApproved));
  await chooseTeam(screen);

  h.approveMutate.mockRejectedValueOnce(new Error('connection reset'));
  h.fetchPending.mockResolvedValue({ users: [], total: 0 });
  await approveButton(screen).click();

  await expect.poll(() => onApproved.mock.calls.length).toBe(1);
  expect(h.approveMutate).toHaveBeenCalledTimes(1);
});

test('a role another administrator changed is shown, not overwritten, when this one left it alone', async () => {
  const screen = await render(dialog());
  await chooseTeam(screen);

  h.approveMutate.mockRejectedValueOnce(new Error('approval failed'));
  h.fetchPending.mockResolvedValue(pendingAs('editor'));
  await approveButton(screen).click();

  await expect.element(screen.getByRole('combobox').nth(0)).toHaveTextContent('Editor');
  await approveButton(screen).click();
  await expect.poll(() => h.approveMutate.mock.calls.length).toBe(2);
  expect(h.updateMutate).not.toHaveBeenCalled();
});

test('nothing is editable while the attempt is in flight, from the role request on', async () => {
  const screen = await render(dialog());
  await chooseRole(screen, 'Editor');
  await chooseTeam(screen);

  const inFlight = deferred<object>();
  h.updateMutate.mockReturnValueOnce(inFlight.promise);
  await approveButton(screen).click();

  await expect.element(screen.getByRole('combobox').nth(0)).toBeDisabled();
  await expect.element(sw(screen, '↳ Stagioni')).toBeDisabled();
  inFlight.resolve({});
});

test('an edit on a leaf killed, then reset by a role change, then revived, is still sent', async () => {
  const screen = await render(dialog());
  await sw(screen, '↳ Stagioni').click();

  h.defaults.data = defaultsWith(['admin.seasons']);
  await screen.rerender(dialog());
  await chooseRole(screen, 'Editor');
  h.defaults.data = defaultsWith();
  await screen.rerender(dialog());
  await chooseTeam(screen);
  await approveButton(screen).click();

  await expect.poll(() => h.approveMutate.mock.calls.length).toBe(1);
  expect(setCalls(h.setMutate)).toEqual([['admin.seasons', true]]);
});

test('a failing fresh read at opening shows no switch and allows no attempt', async () => {
  h.fetchByUser.mockRejectedValue(new Error('network down'));
  const screen = await render(dialog());

  await expect.element(screen.getByText(/chiudi e riapri/)).toBeInTheDocument();
  expect(screen.getByRole('switch').elements()).toHaveLength(0);
  await expect.element(approveButton(screen)).toBeDisabled();
});

describe('without *:*, as an editor who may approve', () => {
  beforeEach(() => {
    h.admin.value = false;
  });

  test('approves the account as it stands: no role, no overrides, not even read', async () => {
    const onApproved = vi.fn();
    const screen = await render(dialog(onApproved));

    await expect.element(screen.getByText(/solo un amministratore può cambiarli/)).toBeVisible();
    await expect.element(screen.getByRole('combobox').nth(0)).toBeDisabled();
    expect(screen.getByRole('switch').elements()).toHaveLength(0);

    await chooseTeam(screen);
    await approveButton(screen).click();

    await vi.waitFor(() => expect(onApproved).toHaveBeenCalled());
    expect(h.approveMutate).toHaveBeenCalledWith({ id: pendingViewer.id, teamId: 't1' });
    expect(h.fetchByUser).not.toHaveBeenCalled();
    expect(h.setMutate).not.toHaveBeenCalled();
    expect(h.updateMutate).not.toHaveBeenCalled();
  });

  test('after a failed approval, re-reads the pending account and still never the overrides', async () => {
    h.approveMutate.mockRejectedValueOnce(new Error('network'));
    const screen = await render(dialog());

    await chooseTeam(screen);
    await approveButton(screen).click();

    await vi.waitFor(() => expect(h.fetchPending).toHaveBeenCalledTimes(2));
    await expect.element(approveButton(screen)).toBeEnabled();
    expect(h.fetchByUser).not.toHaveBeenCalled();
  });
});
