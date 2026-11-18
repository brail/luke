import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import { TooltipProvider } from '../../../../../../components/ui/tooltip';
import { ApproveUserDialog } from '../ApproveUserDialog';

import { defaultsWith, deferred, rows } from './sectionAccessTestKit';

/**
 * An approval attempt is one `approvePending` call carrying the address (if synthetic), the role (if
 * the administrator changed it), the override edits and the team (ADR-044). After any failure the
 * dialog re-reads the stored role, the pending status and the overrides before another attempt
 * (ADR-027). `fetchPending` and `fetchByUser` are those reads.
 */

const h = vi.hoisted(() => ({
  defaults: { data: undefined as unknown },
  fetchByUser: vi.fn(),
  fetchPending: vi.fn(),
  setMutate: vi.fn(),
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

const pendingViewer = { id: 'u-p', username: 'newbie', email: 'newbie@example.com', firstName: 'New', lastName: 'Bie', role: 'viewer' as const };
const syntheticViewer = { ...pendingViewer, email: 'newbie@ldap.local' };
/** The payload of the `n`-th approval call (0-based). */
const approval = (n: number) => h.approveMutate.mock.calls[n]?.[0];
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

function dialog(onApproved = vi.fn(), user = pendingViewer) {
  // The app mounts TooltipProvider once (components/Providers.tsx); the section switches' PermissionTooltip needs it.
  return (
    <TooltipProvider delayDuration={0}>
      <ApproveUserDialog user={user} open onOpenChange={() => undefined} onApproved={onApproved} />
    </TooltipProvider>
  );
}

beforeEach(() => {
  h.admin.value = true;
  h.defaults.data = defaultsWith();
  h.fetchByUser.mockResolvedValue([]);
  h.fetchPending.mockResolvedValue(pendingAs('viewer'));
  h.setMutate.mockResolvedValue(null);
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

test('one call carries the role, the edits and the team; no separate write', async () => {
  const screen = await render(dialog());
  await chooseRole(screen, 'Editor');
  await sw(screen, '↳ Stagioni').click();
  await chooseTeam(screen);
  await approveButton(screen).click();

  await expect.poll(() => h.approveMutate.mock.calls.length).toBe(1);
  expect(approval(0)).toEqual({
    id: 'u-p',
    teamId: 't1',
    role: 'editor',
    sectionOverrides: [{ section: 'admin.seasons', enabled: true }],
  });
  expect(h.setMutate).not.toHaveBeenCalled();
});

test('after a refused approval, which stored nothing, the next attempt sends the same choices again', async () => {
  const screen = await render(dialog());
  await chooseRole(screen, 'Editor');
  await sw(screen, '↳ Stagioni').click();
  await chooseTeam(screen);

  h.approveMutate.mockRejectedValueOnce(new Error('approval refused'));
  await approveButton(screen).click();
  await expect.poll(() => h.fetchPending.mock.calls.length).toBe(2);
  await expect.element(approveButton(screen)).toBeEnabled();

  await approveButton(screen).click();
  await expect.poll(() => h.approveMutate.mock.calls.length).toBe(2);
  expect(approval(1)).toEqual(approval(0));
});

test('after a refused approval, a role change resets the edits but leaves the killed leaves alone', async () => {
  h.defaults.data = defaultsWith(['admin.brands']);
  h.fetchByUser.mockResolvedValue(rows({ 'admin.brands': true }));
  const screen = await render(dialog());
  await sw(screen, '↳ Stagioni').click();
  await chooseTeam(screen);

  h.approveMutate.mockRejectedValueOnce(new Error('approval refused'));
  await approveButton(screen).click();
  await expect.poll(() => h.approveMutate.mock.calls.length).toBe(1);
  await expect.element(approveButton(screen)).toBeEnabled();

  await chooseRole(screen, 'Editor');
  await approveButton(screen).click();

  await expect.poll(() => h.approveMutate.mock.calls.length).toBe(2);
  expect(approval(0).sectionOverrides).toEqual([{ section: 'admin.seasons', enabled: true }]);
  expect(approval(1)).toMatchObject({ role: 'editor', sectionOverrides: [] });
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
  expect(approval(1).role).toBeUndefined();
});

test('nothing is editable while the attempt is in flight', async () => {
  const screen = await render(dialog());
  await chooseRole(screen, 'Editor');
  await chooseTeam(screen);

  const inFlight = deferred<object>();
  h.approveMutate.mockReturnValueOnce(inFlight.promise);
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
  expect(approval(0).sectionOverrides).toEqual([{ section: 'admin.seasons', enabled: true }]);
});

describe('an account on a synthetic address (#272)', () => {
  beforeEach(() => {
    h.fetchPending.mockResolvedValue({ users: [syntheticViewer], total: 1 });
  });

  test('asks for a real address, approves only with a valid one, and sends it in its stored form', async () => {
    const screen = await render(dialog(vi.fn(), syntheticViewer));
    await chooseTeam(screen);
    const field = screen.getByLabelText('Email *');

    // Accepted by the browser's own check (`type="email"`), refused by `EmailSchema`: no dot in the domain.
    await field.fill('person@host');
    await approveButton(screen).click();
    await expect.element(screen.getByText('Email non valida')).toBeVisible();
    expect(h.approveMutate).not.toHaveBeenCalled();

    await field.fill('  Real.Person@Example.COM ');
    await approveButton(screen).click();

    await expect.poll(() => h.approveMutate.mock.calls.length).toBe(1);
    expect(approval(0)).toMatchObject({ email: 'real.person@example.com' });
  });

  test('Enter in the address field submits the approval', async () => {
    const screen = await render(dialog(vi.fn(), syntheticViewer));
    await chooseTeam(screen);
    await screen.getByLabelText('Email *').fill('enter@example.com');
    await userEvent.keyboard('{Enter}');

    await expect.poll(() => h.approveMutate.mock.calls.length).toBe(1);
    expect(approval(0)).toMatchObject({ email: 'enter@example.com' });
  });

  test('keeps the typed address after a refused approval', async () => {
    const screen = await render(dialog(vi.fn(), syntheticViewer));
    await chooseTeam(screen);
    await screen.getByLabelText('Email *').fill('taken@example.com');

    h.approveMutate.mockRejectedValueOnce(new Error('Email già in uso da un altro account'));
    await approveButton(screen).click();
    await expect.element(approveButton(screen)).toBeEnabled();

    await expect.element(screen.getByLabelText('Email *')).toHaveValue('taken@example.com');
  });

  test('an address the user gave meanwhile ends the field: the next attempt sends none', async () => {
    const screen = await render(dialog(vi.fn(), syntheticViewer));
    await chooseTeam(screen);
    await screen.getByLabelText('Email *').fill('typed@example.com');

    h.approveMutate.mockRejectedValueOnce(new Error('refused'));
    h.fetchPending.mockResolvedValue({ users: [pendingViewer], total: 1 });
    await approveButton(screen).click();
    await expect.poll(() => screen.getByLabelText('Email *').elements().length).toBe(0);

    await approveButton(screen).click();
    await expect.poll(() => h.approveMutate.mock.calls.length).toBe(2);
    expect(approval(1).email).toBeUndefined();
  });

  test('an account with a real address shows no address field and sends none', async () => {
    h.fetchPending.mockResolvedValue(pendingAs('viewer'));
    const screen = await render(dialog());
    await chooseTeam(screen);
    await approveButton(screen).click();

    await expect.poll(() => h.approveMutate.mock.calls.length).toBe(1);
    expect(screen.getByLabelText('Email *').elements()).toHaveLength(0);
    expect(approval(0).email).toBeUndefined();
  });
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
    expect(h.approveMutate).toHaveBeenCalledWith({ id: pendingViewer.id, teamId: 't1', sectionOverrides: [] });
    expect(h.fetchByUser).not.toHaveBeenCalled();
    expect(h.setMutate).not.toHaveBeenCalled();
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
