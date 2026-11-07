/**
 * A settings test, or the NAV preview, that the external system refuses answers PRECONDITION_FAILED
 * with a fixed Italian text the admin can act on (#193). The system's own error text never reaches
 * the answer — production masks a 5xx, but a 4xx keeps its message — only the log.
 */

import { Client, InvalidCredentialsError } from 'ldapts';
import nodemailer from 'nodemailer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaClient } from '@luke/db';
import * as nav from '@luke/nav';

import { createCallerAs, setupTestDb } from './helpers';

/** Text only the external system's error carries: it must appear in no answer. */
const DRIVER_TEXT = 'driver-detail-7f3a';

let prisma: PrismaClient;
let caller: Awaited<ReturnType<typeof createCallerAs>>;

beforeEach(async () => {
  prisma = await setupTestDb();
  caller = await createCallerAs('admin');
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** The rejection of `call`, serialised whole, so a field anywhere in it is checked. */
async function refusal(call: Promise<unknown>) {
  const error = await call.then(() => { throw new Error('expected a refusal'); }, (e: unknown) => e);
  return { error, serialised: JSON.stringify(error, Object.getOwnPropertyNames(error as object)) };
}

describe('LDAP settings tests', () => {
  beforeEach(async () => {
    await caller.integrations.auth.saveLdapConfig({
      enabled: true,
      url: 'ldap://dc.test:389',
      bindDN: 'cn=svc,dc=test',
      bindPassword: 'service-password',
      searchBase: 'dc=test',
      searchFilter: '(uid=${username})',
      groupSearchBase: '',
      groupSearchFilter: '',
      roleMapping: '',
      strategy: 'local-first',
    });
    vi.spyOn(Client.prototype, 'unbind').mockResolvedValue(undefined);
  });

  it.each([
    ['a bind the directory refuses', new InvalidCredentialsError(DRIVER_TEXT), 'Connessione LDAP fallita: credenziali di bind non valide'],
    ['any other connection failure', new Error(`connect ECONNREFUSED ${DRIVER_TEXT}`), 'Connessione LDAP fallita: verifica URL, raggiungibilità del server, certificato TLS e bind DN'],
  ])('the connection test answers %s with a fixed text', async (_case, failure, message) => {
    vi.spyOn(Client.prototype, 'bind').mockRejectedValue(failure);

    const { error, serialised } = await refusal(caller.integrations.auth.testLdapConnection());

    expect(error).toMatchObject({ code: 'PRECONDITION_FAILED', message });
    expect(serialised).not.toContain(DRIVER_TEXT);
  });

  it('the search test answers a refused bind and a failed search with fixed texts', async () => {
    const bind = vi.spyOn(Client.prototype, 'bind').mockRejectedValue(new InvalidCredentialsError(DRIVER_TEXT));
    const refusedBind = await refusal(caller.integrations.auth.testLdapSearch({ username: 'alice' }));
    expect(refusedBind.error).toMatchObject({ code: 'PRECONDITION_FAILED', message: 'Connessione LDAP fallita: credenziali di bind non valide' });
    expect(refusedBind.serialised).not.toContain(DRIVER_TEXT);

    bind.mockResolvedValue(undefined);
    vi.spyOn(Client.prototype, 'search').mockRejectedValue(new Error(DRIVER_TEXT));
    const failedSearch = await refusal(caller.integrations.auth.testLdapSearch({ username: 'alice' }));
    expect(failedSearch.error).toMatchObject({ code: 'PRECONDITION_FAILED', message: 'Ricerca LDAP fallita: verifica base e filtro di ricerca' });
    expect(failedSearch.serialised).not.toContain(DRIVER_TEXT);
  });
});

describe('mail settings test', () => {
  const verify = vi.fn();

  beforeEach(async () => {
    vi.spyOn(nodemailer, 'createTransport').mockReturnValue({
      verify,
      sendMail: vi.fn(async () => ({ messageId: 'id' })),
      close: vi.fn(),
    } as never); // Only what the test procedure calls of a transport.
    await caller.integrations.mail.saveConfig({
      host: 'smtp.test', port: 587, secure: false, user: 'mailer', pass: 'smtp-password',
      from: 'luke@example.com', baseUrl: 'https://luke.example.com',
    });
  });

  it.each([
    ['a refused login', Object.assign(new Error(`535 ${DRIVER_TEXT}`), { code: 'EAUTH' }), 'Accesso SMTP rifiutato: credenziali non valide'],
    ['a refused recipient or sender', Object.assign(new Error(`550 ${DRIVER_TEXT}`), { code: 'EENVELOPE' }), 'Invio di prova rifiutato: verifica destinatario e mittente'],
    ['any other failure', new Error(`ECONNREFUSED ${DRIVER_TEXT}`), 'Test SMTP fallito: verifica server, porta e sicurezza'],
  ])('answers %s with a fixed text', async (_case, failure, message) => {
    verify.mockRejectedValueOnce(failure);

    const { error, serialised } = await refusal(caller.integrations.mail.test({}));

    expect(error).toMatchObject({ code: 'PRECONDITION_FAILED', message });
    expect(serialised).not.toContain(DRIVER_TEXT);
  });

  it('keeps a database failure a server error, not an SMTP refusal', async () => {
    vi.spyOn(prisma.appConfig, 'findMany').mockRejectedValue(new Error('database unreachable'));
    vi.spyOn(prisma.appConfig, 'findUnique').mockRejectedValue(new Error('database unreachable'));

    await expect(caller.integrations.mail.test({})).rejects.toMatchObject({ code: 'INTERNAL_SERVER_ERROR' });
    expect(verify).not.toHaveBeenCalled();
  });
});

describe('NAV settings', () => {
  beforeEach(async () => {
    vi.spyOn(nav, 'closePool').mockResolvedValue(undefined);
    await caller.integrations.nav.saveConfig({
      host: 'nav.test', port: 1433, database: 'NAV', user: 'reader', password: 'nav-password',
      company: 'CO', readOnly: true, syncEnabled: false,
    });
  });

  it('a failed test answers its step\'s fixed text, the driver detail nowhere', async () => {
    vi.spyOn(nav, 'testNavConnection').mockResolvedValue({
      success: false,
      steps: [{ name: 'SQL Query', ok: false, message: 'Query di prova non riuscita: verifica i permessi sul database.', detail: DRIVER_TEXT }],
    });

    const { error, serialised } = await refusal(caller.integrations.nav.testConnection());

    expect(error).toMatchObject({ code: 'PRECONDITION_FAILED', message: 'Query di prova non riuscita: verifica i permessi sul database.' });
    expect(serialised).not.toContain(DRIVER_TEXT);
  });

  it('a passed test returns its steps without their detail', async () => {
    vi.spyOn(nav, 'testNavConnection').mockResolvedValue({
      success: true,
      steps: [{ name: 'SQL Query', ok: true, message: 'Database is responding correctly', detail: DRIVER_TEXT }],
    });

    const result = await caller.integrations.nav.testConnection();

    expect(result.steps).toEqual([{ name: 'SQL Query', ok: true, message: 'Database is responding correctly' }]);
    expect(JSON.stringify(result)).not.toContain(DRIVER_TEXT);
  });

  const failQuery = () => vi.spyOn(nav, 'getPool').mockResolvedValue({
    // Only what `createSyncRequest` and the preview call of a pool.
    request: () => ({ query: async () => { throw new Error(DRIVER_TEXT); } }),
  } as never);

  it.each([
    ['the connection', 'vendor', () => vi.spyOn(nav, 'getPool').mockRejectedValue(new Error(DRIVER_TEXT))],
    ['the query', 'vendor', failQuery],
    ['the query', 'brand', failQuery],
    ['the query', 'season', failQuery],
  ] as const)('the preview answers a failure of %s (%s) with a fixed text', async (_case, entity, fail) => {
    fail();

    const { error, serialised } = await refusal(caller.integrations.nav.sync.preview({ entity }));

    expect(error).toMatchObject({ code: 'PRECONDITION_FAILED', message: 'Query NAV non riuscita: verifica connessione e company' });
    expect(serialised).not.toContain(DRIVER_TEXT);
  });
});
