import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';

import { UNREADABLE_VALUE_MESSAGE as NOTICE } from '../../../../components/settings/UnreadableValueNotice';
import GoogleWorkspacePage from '../google/page';
import LdapSettingsPage from '../ldap/page';
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

const h = vi.hoisted(() => ({
  ldap: {} as Record<string, unknown>,
  google: {} as Record<string, unknown>,
  refetchLdap: vi.fn(),
  saveLdap: vi.fn(),
  testConnection: vi.fn(),
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
  return {
    trpc: {
      useUtils: () => ({ storage: { getConfig: { invalidate: vi.fn() } } }),
      integrations: {
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
});

afterEach(() => {
  vi.clearAllMocks();
});

test('LDAP off: the unreadable field is marked and editable, and only with something to repair', async () => {
  const screen = await render(<LdapSettingsPage />);

  await expect.element(screen.getByText(NOTICE)).toBeVisible();
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

  await expect.element(screen.getByText(NOTICE).nth(1)).toBeVisible();
  expect(h.testConnection).not.toHaveBeenCalled();
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
