/**
 * A settings test, or the NAV preview, that the external system refuses answers PRECONDITION_FAILED
 * with a fixed Italian text the admin can act on (#193, #255 for storage and Google), and a
 * configuration batch save or import names a key's server failure with a fixed text (#255). The
 * system's own error text never reaches the answer — production masks a 5xx, but a 4xx keeps its
 * message — only the log.
 */

import { S3Client } from '@aws-sdk/client-s3';
import { Client, InvalidCredentialsError } from 'ldapts';
import nodemailer from 'nodemailer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as calendar from '@luke/calendar';
import type { PrismaClient } from '@luke/db';
import * as nav from '@luke/nav';

import { saveConfigs } from '../src/lib/configManager';

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

describe('storage settings test', () => {
  /** An S3 reply as AWS SDK v3 throws it: a named error carrying `$metadata`. */
  const s3Error = (name: string) => Object.assign(new Error(DRIVER_TEXT), { name, $metadata: { httpStatusCode: 403 } });
  /** A Node network or TLS error: its `code` says what failed. */
  const networkError = (code: string) => Object.assign(new Error(`${code} ${DRIVER_TEXT}`), { code });

  beforeEach(async () => {
    await caller.storage.saveConfig({
      type: 's3', endpoint: 'minio.example.com', port: 9000, useSSL: true, accessKey: 'ak', secretKey: 'sk',
      region: 'us-east-1', presignedPutTtl: 3600, presignedGetTtl: 3600,
    });
  });

  it.each([
    ['an unreachable endpoint', networkError('ECONNREFUSED'), 'Server S3 non raggiungibile: verifica endpoint e porta'],
    ['SSL on a plain port', networkError('ERR_SSL_WRONG_VERSION_NUMBER'), 'Connessione TLS al server S3 non riuscita: verifica SSL, porta e certificato'],
    ['a refused certificate', networkError('DEPTH_ZERO_SELF_SIGNED_CERT'), 'Connessione TLS al server S3 non riuscita: verifica SSL, porta e certificato'],
    ['a refused access key', s3Error('InvalidAccessKeyId'), 'Accesso S3 rifiutato: verifica access key e secret key'],
    ['a refused secret', s3Error('SignatureDoesNotMatch'), 'Accesso S3 rifiutato: verifica access key e secret key'],
    ['a refused bucket create', s3Error('AccessDenied'), 'Accesso S3 negato: verifica i permessi delle credenziali sui bucket'],
    ['any other failure', new Error(DRIVER_TEXT), 'Test S3 fallito: verifica endpoint, credenziali e bucket'],
  ])('answers %s with a fixed text', async (_case, failure, message) => {
    vi.spyOn(S3Client.prototype, 'send').mockRejectedValue(failure);

    const { error, serialised } = await refusal(caller.storage.testS3Connection());

    expect(error).toMatchObject({ code: 'PRECONDITION_FAILED', message });
    expect(serialised).not.toContain(DRIVER_TEXT);
  });

  it('answers missing credentials with a fixed text, before reaching S3', async () => {
    const send = vi.spyOn(S3Client.prototype, 'send');
    await prisma.appConfig.deleteMany({ where: { key: 'storage.s3.secretKey' } });

    await expect(caller.storage.testS3Connection()).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: 'Credenziali S3 non configurate: inserisci access key e secret key e salva.',
    });
    expect(send).not.toHaveBeenCalled();
  });

  it('keeps a database failure reading the S3 settings a server error, not an S3 refusal', async () => {
    const send = vi.spyOn(S3Client.prototype, 'send');
    const findUnique = prisma.appConfig.findUnique.bind(prisma.appConfig);
    // Typed as the lookup by key the settings readers make; every other lookup passes through as it came.
    vi.spyOn(prisma.appConfig, 'findUnique').mockImplementation(((args: { where: { key: string } }) =>
      args.where.key.startsWith('storage.s3.') ? Promise.reject(new Error('database unreachable')) : findUnique(args as never)
    ) as never);

    await expect(caller.storage.testS3Connection()).rejects.toMatchObject({ code: 'INTERNAL_SERVER_ERROR' });
    expect(send).not.toHaveBeenCalled();
  });
});

describe('Google settings test', () => {
  /** A refused token request as googleapis throws it: the OAuth error code in the reply body. */
  const oauthRefusal = (error: unknown) => Object.assign(new Error(DRIVER_TEXT), { response: { data: { error, error_description: DRIVER_TEXT } } });

  /** Google's `failure` reaches the admin as `message` alone. */
  const expectRefusedWith = async (failure: Error, message: string) => {
    vi.spyOn(calendar, 'testGoogleConnection').mockRejectedValue(failure);
    const { error, serialised } = await refusal(caller.integrations.google.testConnection());
    expect(error).toMatchObject({ code: 'PRECONDITION_FAILED', message });
    expect(serialised).not.toContain(DRIVER_TEXT);
  };

  describe('service account', () => {
    beforeEach(async () => {
      await caller.integrations.google.saveConfig({
        authMode: 'service_account', domain: 'example.com', calendarSyncEnabled: false,
        serviceEmail: 'luke@project.iam.gserviceaccount.com', serviceKey: 'service-key', impersonateEmail: '',
      });
    });

    it.each([
      ['a refused key', oauthRefusal('invalid_grant'), 'Chiave del service account rifiutata: verifica chiave e utente da impersonare'],
      ['a missing domain-wide delegation', oauthRefusal('unauthorized_client'), 'Delega a livello di dominio mancante: autorizza il service account nella console Admin'],
      ['a Calendar API error', oauthRefusal({ code: 403, message: DRIVER_TEXT }), 'Test Google non riuscito: verifica dominio e credenziali'],
      ['a network failure', new Error(`getaddrinfo ENOTFOUND ${DRIVER_TEXT}`), 'Test Google non riuscito: verifica dominio e credenziali'],
    ])('answers %s with a fixed text', async (_case, failure, message) => {
      await expectRefusedWith(failure, message);
    });
  });

  describe('OAuth', () => {
    beforeEach(async () => {
      await caller.integrations.google.saveConfig({
        authMode: 'oauth_user', domain: 'example.com', calendarSyncEnabled: false,
        oauthClientId: 'client-id', oauthClientSecret: 'client-secret',
      });
      await saveConfigs(prisma, [{ key: 'integrations.google.oauth.refreshToken', value: 'refresh-token', encrypt: true }]);
    });

    it.each([
      ['a refused client', oauthRefusal('invalid_client'), 'Client OAuth rifiutato: verifica Client ID e Client Secret'],
      ['an expired or revoked grant', oauthRefusal('invalid_grant'), "Autorizzazione Google scaduta o revocata: connetti di nuovo l'account"],
      ['a client not allowed this grant', oauthRefusal('unauthorized_client'), 'Client OAuth non autorizzato a questo accesso: verifica il client nella console Google Cloud'],
    ])('answers %s with a fixed text', async (_case, failure, message) => {
      await expectRefusedWith(failure, message);
    });
  });
});

describe('configuration batch save and import', () => {
  it.each([
    ['setMultiple', async () => (await caller.config.setMultiple({ configs: [{ key: 'app.name', value: 'Luke' }] }))[0]],
    ['importJson', async () => (await caller.config.importJson({ items: [{ key: 'app.name', value: 'Luke' }] })).errors[0]],
  ] as const)('%s answers a database failure on one key with a fixed text', async (_case, save) => {
    vi.spyOn(prisma, '$transaction').mockRejectedValue(new Error(DRIVER_TEXT));

    const item = await save();

    expect(item).toMatchObject({ key: 'app.name', error: 'Salvataggio non riuscito: errore del server' });
    expect(JSON.stringify(item)).not.toContain(DRIVER_TEXT);
  });

  it('keeps the text of a refusal the app wrote for the caller', async () => {
    const [item] = await caller.config.setMultiple({ configs: [{ key: 'smtp.port', value: '587' }] });

    expect(item).toMatchObject({ key: 'smtp.port', success: false, error: expect.stringMatching(/^Prefisso non ammesso: smtp\./) });
  });
});
