import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';

import { UNREADABLE_VALUE_MESSAGE as NOTICE } from '../../../../components/settings/UnreadableValueNotice';
import GoogleWorkspacePage from '../google/page';
import LdapSettingsPage from '../ldap/page';
import MailSettingsPage from '../mail/page';
import NavSettingsPage from '../nav/page';
import StoragePage from '../storage/page';

/**
 * A stored value this instance cannot decrypt, as after a restore under another master key: the
 * page opens with the field marked and editable, so the admin can enter it again and save.
 */

const LDAP = {
  enabled: false,
  url: '',
  hasBindDN: true,
  hasBindPassword: true,
  searchBase: 'dc=test',
  searchFilter: '(uid=${username})',
  groupSearchBase: '',
  groupSearchFilter: '',
  roleMapping: '',
  strategy: 'local-first',
  unreadable: ['url'],
};

const STORAGE = {
  type: 's3',
  local: { basePath: '/tmp', maxFileSizeMB: 50, enableProxy: true },
  s3: {
    endpoint: 'minio.example.com',
    port: 9000,
    useSSL: true,
    accessKey: 'ak',
    accessKeyUnreadable: false,
    hasSecretKey: false,
    secretKeyUnreadable: true,
    region: 'us-east-1',
    publicBaseUrl: '',
    presignedPutTtl: 3600,
    presignedGetTtl: 3600,
  },
};

const GOOGLE = {
  authMode: 'oauth_user',
  domain: 'example.com',
  calendarSyncEnabled: false,
  serviceEmail: '',
  hasServiceKey: false,
  serviceKeyUnreadable: false,
  impersonateEmail: '',
  oauthClientId: 'client-id',
  hasOauthClientSecret: true,
  oauthClientSecretUnreadable: false,
  hasOauthToken: true,
  oauthTokenUnreadable: false,
  oauthUserEmail: 'admin@example.com',
};
const TOKEN_NOTICE = "Il token salvato non è leggibile: connetti di nuovo l'account.";
/** The LDAP page says more: any unreadable value stops LDAP sign-in (#193). */
const LDAP_NOTICE = /non è leggibile e blocca l'accesso LDAP/;

const h = vi.hoisted(() => ({
  ldap: {} as Record<string, unknown>,
  google: {} as Record<string, unknown>,
  passwordUnreadable: false,
  passwordError: null as Error | null,
  refetchPassword: vi.fn(),
  refetchLdap: vi.fn(),
  saveLdap: vi.fn(),
  testConnection: vi.fn(),
  deleteConfig: vi.fn(),
  saveStorage: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { role: 'admin' }, accessToken: 't' } }),
}));
vi.mock('../../../../lib/trpc', () => {
  const idle = { useMutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }) };
  // Stable across renders: the pages reset their form when these change.
  const storedRows = {
    items: [
      { key: 'smtp.pass', valuePreview: '••••' },
      { key: 'integrations.nav.password', valuePreview: '••••' },
    ],
  };
  const noRows: unknown[] = [];
  const passwordState = {
    useQuery: () => ({
      data: h.passwordError
        ? undefined
        : { hasPassword: !h.passwordUnreadable, passwordUnreadable: h.passwordUnreadable },
      isPending: false,
      error: h.passwordError,
      refetch: h.refetchPassword,
    }),
  };
  return {
    trpc: {
      useUtils: () => ({
        storage: { getConfig: { invalidate: vi.fn() } },
        config: { invalidate: vi.fn() },
        integrations: {
          mail: { getPasswordState: { invalidate: vi.fn() } },
          nav: { getPasswordState: { invalidate: vi.fn() } },
        },
      }),
      config: {
        list: {
          useQuery: () => ({ data: storedRows, isPending: false, error: null, refetch: vi.fn() }),
        },
        getMultiple: { useQuery: () => ({ data: noRows, isPending: false, error: null, refetch: vi.fn() }) },
        delete: {
          useMutation: (options: { onSettled?: () => void }) => ({
            mutate: (variables: { key: string }, call?: { onSuccess?: () => void }) => {
              h.deleteConfig(variables);
              call?.onSuccess?.();
              options.onSettled?.();
            },
            isPending: false,
          }),
        },
      },
      integrations: {
        mail: { getPasswordState: passwordState, saveConfig: idle, test: idle },
        nav: { getPasswordState: passwordState, saveConfig: idle, testConnection: idle },
        auth: {
          getLdapConfig: {
            useQuery: () => ({ data: h.ldap, isPending: false, error: null, refetch: h.refetchLdap }),
          },
          saveLdapConfig: {
            useMutation: (options: { onSuccess: () => void }) => ({
              mutate: (payload: unknown) => {
                h.saveLdap(payload);
                options.onSuccess();
              },
              isPending: false,
            }),
          },
          testLdapConnection: { useMutation: () => ({ mutate: h.testConnection, isPending: false }) },
          testLdapSearch: idle,
        },
        google: {
          getConfig: { useQuery: () => ({ data: h.google, isPending: false, error: null, refetch: vi.fn() }) },
          saveConfig: idle,
          testConnection: idle,
          getOAuthUrl: idle,
          exchangeOAuthCode: idle,
          disconnectOAuth: idle,
        },
      },
      storage: {
        getConfig: { useQuery: () => ({ data: STORAGE, isPending: false, error: null, refetch: vi.fn() }) },
        saveConfig: { useMutation: () => ({ mutateAsync: h.saveStorage, isPending: false }) },
        testS3Connection: idle,
      },
    },
  };
});

beforeEach(() => {
  h.ldap = LDAP;
  h.google = GOOGLE;
  h.passwordUnreadable = false;
  h.passwordError = null;
});

afterEach(() => {
  vi.clearAllMocks();
});

test.each([
  ['mail', MailSettingsPage],
  ['NAV', NavSettingsPage],
])('%s: a failed read of the password state is the page load error, with a retry', async (_label, Page) => {
  h.passwordError = new Error('password state failed');

  const screen = await render(<Page />);

  await screen.getByRole('button', { name: 'Riprova' }).click();
  expect(h.refetchPassword).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText(/^Password/).elements()).toHaveLength(0);
});

test('LDAP off: the unreadable field is marked and editable, and only with something to repair', async () => {
  const screen = await render(<LdapSettingsPage />);

  await expect.element(screen.getByText(LDAP_NOTICE)).toBeVisible();
  await expect.element(screen.getByLabelText(/^URL LDAP/)).toBeEnabled();
});

test('LDAP off with nothing unreadable: the fields stay locked', async () => {
  h.ldap = { ...LDAP, url: 'ldap://dc.test:389', unreadable: [] };

  const screen = await render(<LdapSettingsPage />);

  await expect.element(screen.getByLabelText(/^URL LDAP/)).toBeDisabled();
  expect(screen.getByText(NOTICE).elements()).toHaveLength(0);
});

// Each request spends the small `ldapTest` budget, which the test after the repair needs.
test('with something unreadable the test answers on the page, and spends no request', async () => {
  const screen = await render(<LdapSettingsPage />);

  await screen.getByRole('button', { name: 'Test Connessione' }).click();

  await expect.element(screen.getByText(NOTICE)).toBeVisible();
  expect(h.testConnection).not.toHaveBeenCalled();
});

// #193: an unreadable optional value blocks nothing, and can be removed.
const LDAP_ON_ROLE_MAPPING_UNREADABLE = { ...LDAP, enabled: true, url: 'ldap://dc.test:389', unreadable: ['roleMapping'] };

test('an unreadable role mapping stops neither test', async () => {
  h.ldap = LDAP_ON_ROLE_MAPPING_UNREADABLE;
  const screen = await render(<LdapSettingsPage />);

  await screen.getByRole('button', { name: 'Test Connessione' }).click();
  await vi.waitFor(() => expect(h.testConnection).toHaveBeenCalledTimes(1));
  await screen.getByRole('button', { name: 'Test Ricerca' }).click();

  await expect.element(screen.getByPlaceholder('Username da cercare')).toBeVisible();
});

test('Rimuovi asks first, deletes the key, and keeps the other unsaved edits', async () => {
  h.ldap = LDAP_ON_ROLE_MAPPING_UNREADABLE;
  const screen = await render(<LdapSettingsPage />);

  await screen.getByLabelText(/^Search Base/).fill('dc=nuovo');
  await screen.getByRole('button', { name: 'Rimuovi' }).click();
  await expect.element(screen.getByText(/i ruoli degli utenti esistenti non cambiano/)).toBeVisible();
  await screen.getByRole('button', { name: 'Rimuovi' }).last().click();

  expect(h.deleteConfig).toHaveBeenCalledWith({ key: 'auth.ldap.roleMapping' });
  await expect.element(screen.getByText(LDAP_NOTICE)).not.toBeInTheDocument();
  await expect.element(screen.getByLabelText(/^Search Base/)).toHaveValue('dc=nuovo');
});

test('LDAP off: removing the last unreadable value leaves the fields editable', async () => {
  h.ldap = { ...LDAP, url: 'ldap://dc.test:389', unreadable: ['roleMapping'] };
  const screen = await render(<LdapSettingsPage />);

  await screen.getByRole('button', { name: 'Rimuovi' }).click();
  await screen.getByRole('button', { name: 'Rimuovi' }).last().click();

  await expect.element(screen.getByText(LDAP_NOTICE)).not.toBeInTheDocument();
  await expect.element(screen.getByLabelText(/^URL LDAP/)).toBeEnabled();
});

test('a field LDAP needs has no Rimuovi: it is entered again', async () => {
  const screen = await render(<LdapSettingsPage />);

  await expect.element(screen.getByText(LDAP_NOTICE)).toBeVisible();
  expect(screen.getByRole('button', { name: 'Rimuovi' }).elements()).toHaveLength(0);
});

test('the role mapping placeholder does not read as a stored mapping', async () => {
  const screen = await render(<LdapSettingsPage />);

  await expect.element(screen.getByLabelText('Role Mapping (JSON)')).toHaveAttribute('placeholder', 'Nessuna mappatura');
});

test('the stored strategy is the one shown', async () => {
  h.ldap = { ...LDAP, strategy: 'ldap-first', unreadable: [] };

  const screen = await render(<LdapSettingsPage />);

  await expect.element(screen.getByRole('combobox')).toHaveTextContent('LDAP prima, poi locale');
});

test('a save reads the page again, so that the warning goes', async () => {
  const screen = await render(<LdapSettingsPage />);

  await screen.getByLabelText(/^URL LDAP/).fill('ldap://dc.test:389');
  await screen.getByRole('button', { name: /^Salva/ }).click();

  await vi.waitFor(() => expect(h.saveLdap).toHaveBeenCalledTimes(1));
  expect(h.refetchLdap).toHaveBeenCalledTimes(1);
});

test('an unreadable storage secret is marked, and a blank one is not saved', async () => {
  const screen = await render(<StoragePage />);

  await expect.element(screen.getByText(NOTICE)).toBeVisible();

  await screen.getByRole('button', { name: 'Salva configurazione' }).click();

  await expect.element(screen.getByText('Secret key richiesta')).toBeVisible();
  expect(h.saveStorage).not.toHaveBeenCalled();
});

test('Google with everything readable: no notice, and the account shows as connected', async () => {
  const screen = await render(<GoogleWorkspacePage />);

  await expect.element(screen.getByText('Connesso', { exact: true })).toBeVisible();
  await expect.element(screen.getByText('admin@example.com')).toBeVisible();
  expect(screen.getByText(NOTICE).elements()).toHaveLength(0);
  expect(screen.getByText(TOKEN_NOTICE).elements()).toHaveLength(0);
});

test('Google: an unreadable service key is marked and can be entered again', async () => {
  h.google = { ...GOOGLE, authMode: 'service_account', serviceKeyUnreadable: true };

  const screen = await render(<GoogleWorkspacePage />);

  await expect.element(screen.getByText(NOTICE)).toBeVisible();
  await expect.element(screen.getByLabelText(/^Private Key/)).toBeEnabled();
});

test('Google: an unreadable client secret is marked', async () => {
  h.google = { ...GOOGLE, hasOauthClientSecret: false, oauthClientSecretUnreadable: true };

  const screen = await render(<GoogleWorkspacePage />);

  await expect.element(screen.getByText(NOTICE)).toBeVisible();
});

test('Google: a value a blank save would keep carries no required mark', async () => {
  h.google = { ...GOOGLE, hasOauthClientSecret: false, oauthClientSecretUnreadable: true };

  const screen = await render(<GoogleWorkspacePage />);

  await expect.element(screen.getByText(/^OAuth Client Secret/)).toBeVisible();
  expect(screen.getByText(/^OAuth Client Secret/).element().textContent).not.toContain('*');

  h.google = { ...GOOGLE, authMode: 'service_account', serviceKeyUnreadable: true };
  await screen.rerender(<GoogleWorkspacePage />);

  await expect.element(screen.getByText(/^Private Key/)).toBeVisible();
  expect(screen.getByText(/^Private Key/).element().textContent).not.toContain('*');
});

test.each([
  ['mail', MailSettingsPage, 'Password SMTP'],
  ['NAV', NavSettingsPage, 'Password SQL'],
])('%s: an unreadable password is marked, not shown as stored, and can be entered again', async (_page, Page, label) => {
  h.passwordUnreadable = true;

  const screen = await render(<Page />);

  await expect.element(screen.getByText(NOTICE)).toBeVisible();
  expect(screen.getByText(new RegExp(`^${label}`)).element().textContent).not.toContain('*');
  const field = screen.getByLabelText(new RegExp(`^${label}`));
  await expect.element(field).toBeEnabled();
  await expect.element(field).not.toHaveAttribute('placeholder', expect.stringContaining('già configurato'));
});

test.each([
  ['mail', MailSettingsPage, 'Password SMTP'],
  ['NAV', NavSettingsPage, 'Password SQL'],
])('%s: a readable password shows as stored, with no notice', async (_page, Page, label) => {
  const screen = await render(<Page />);

  await expect.element(screen.getByLabelText(new RegExp(`^${label}`))).toHaveAttribute(
    'placeholder',
    expect.stringContaining('già configurato')
  );
  expect(screen.getByText(NOTICE).elements()).toHaveLength(0);
});

test('Google: an unreadable token names its account, is not connected, and can be replaced or removed', async () => {
  h.google = { ...GOOGLE, hasOauthToken: false, oauthTokenUnreadable: true };

  const screen = await render(<GoogleWorkspacePage />);

  await expect.element(screen.getByText(TOKEN_NOTICE)).toBeVisible();
  await expect.element(screen.getByText('admin@example.com')).toBeVisible();
  expect(screen.getByText('Connesso', { exact: true }).elements()).toHaveLength(0);
  await expect.element(screen.getByRole('button', { name: 'Disconnetti' })).toBeEnabled();
  await expect.element(screen.getByRole('button', { name: 'Riconnetti' })).toBeEnabled();
});

test('Google: a connected account without an address still shows as connected', async () => {
  h.google = { ...GOOGLE, oauthUserEmail: '' };

  const screen = await render(<GoogleWorkspacePage />);

  await expect.element(screen.getByText('Connesso', { exact: true })).toBeVisible();
});

// #112: a stored role mapping the registry refuses is shown as stored, marked, for correction.
test('an invalid stored role mapping is shown in its field, naming the group, and editable with LDAP off', async () => {
  h.ldap = { ...LDAP, url: 'ldap://dc.test:389', unreadable: [], roleMapping: '{"cn=admins":"admn"}', roleMappingInvalid: true };
  const screen = await render(<LdapSettingsPage />);

  await expect.element(screen.getByLabelText(/^Role Mapping/)).toHaveValue('{"cn=admins":"admn"}');
  await expect.element(screen.getByLabelText(/^Role Mapping/)).toBeEnabled();
  await expect.element(screen.getByText(/Ruolo non valido per il gruppo "cn=admins"/)).toBeVisible();
  await expect.element(screen.getByText(/La mappatura salvata non è valida/)).toBeVisible();
});
