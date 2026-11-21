/**
 * LDAP over TLS against a real TLS server with a self-signed certificate (#281), through real ldapts:
 * the connection test binds when the certificate is trusted, and otherwise answers a fixed text that
 * names the reason; verification holds whatever `NODE_TLS_REJECT_UNAUTHORIZED` says; a value that is
 * not certificates is refused before anything is written, by every writer.
 */

import { Client } from 'ldapts';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaClient } from '@luke/db';

import { saveConfigs } from '../src/lib/configManager';
import { checkLdap } from '../src/observability/readiness';

import { createCallerAs, setupTestDb } from './helpers';
import { startLdapsServer, type LdapsServer } from './helpers/ldapsServer';

const UNTRUSTED =
  'Connessione LDAP fallita: il certificato del server non è attendibile. Incolla in «Certificati attendibili» il certificato del server o della CA che lo ha emesso.';
const WRONG_HOST =
  "Connessione LDAP fallita: il nome del server nell'URL non corrisponde al certificato. Usa nell'URL il nome riportato nel certificato.";
const NOT_A_CERTIFICATE = '-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----\n';

let server: LdapsServer;
let prisma: PrismaClient;
let caller: Awaited<ReturnType<typeof createCallerAs>>;

beforeAll(async () => {
  server = await startLdapsServer();
});

afterAll(async () => {
  await server.close();
});

beforeEach(async () => {
  prisma = await setupTestDb();
  caller = await createCallerAs('admin');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function saveConnection(host: string, trustedCertificates = '') {
  return caller.integrations.auth.saveLdapConfig({
    enabled: true,
    url: `ldaps://${host}:${server.port}`,
    bindDN: 'cn=svc,dc=test',
    bindPassword: 'service-password',
    searchBase: 'dc=test',
    searchFilter: '(uid=${username})',
    groupSearchBase: '',
    groupSearchFilter: '',
    roleMapping: '',
    trustedCertificates,
  });
}

describe('the connection test over ldaps://', () => {
  it('binds to a server whose self-signed certificate is trusted', async () => {
    await saveConnection('localhost', server.certificate);

    await expect(caller.integrations.auth.testLdapConnection()).resolves.toMatchObject({ success: true });
  });

  it('says the certificate is not trusted when it is not', async () => {
    await saveConnection('localhost');

    await expect(caller.integrations.auth.testLdapConnection()).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: UNTRUSTED,
    });
  });

  it('says the host does not match when the URL names one the certificate does not', async () => {
    await saveConnection('127.0.0.1', server.certificate);

    await expect(caller.integrations.auth.testLdapConnection()).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: WRONG_HOST,
    });
  });

  it('keeps verifying when NODE_TLS_REJECT_UNAUTHORIZED turns the default off', async () => {
    vi.stubEnv('NODE_TLS_REJECT_UNAUTHORIZED', '0');
    // The variable is in force: a client that leaves the choice to Node binds to the untrusted server.
    const unguarded = new Client({ url: `ldaps://localhost:${server.port}`, tlsOptions: { ca: [] } });
    await expect(unguarded.bind('cn=svc,dc=test', 'service-password')).resolves.toBeUndefined();
    await unguarded.unbind();

    await saveConnection('localhost');

    await expect(caller.integrations.auth.testLdapConnection()).rejects.toMatchObject({ message: UNTRUSTED });
  });

  it('the search test binds over the trusted certificate and reaches the search', async () => {
    await saveConnection('localhost', server.certificate);

    // The server answers binds only: the search is what fails, so the bind went through.
    await expect(caller.integrations.auth.testLdapSearch({ username: 'alice' })).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: 'Ricerca LDAP fallita: verifica base e filtro di ricerca',
    });
  });

  it('a stored certificate that does not decrypt stops the test instead of being ignored', async () => {
    await saveConnection('localhost', server.certificate);
    await prisma.appConfig.update({
      where: { key: 'auth.ldap.trustedCertificates' },
      data: { value: 'not-a-ciphertext', isEncrypted: true },
    });

    await expect(caller.integrations.auth.testLdapConnection()).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'Un valore salvato non è leggibile: inseriscilo di nuovo e salva.',
    });
  });

  it('the search test refuses an untrusted server with the same text', async () => {
    await saveConnection('localhost');

    await expect(caller.integrations.auth.testLdapSearch({ username: 'alice' })).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: UNTRUSTED,
    });
  });

  it('readiness binds with the trusted certificate and fails without it', async () => {
    await saveConnection('localhost', server.certificate);
    await expect(checkLdap(prisma)).resolves.toEqual({ ok: true });

    await saveConnection('localhost');
    await expect(checkLdap(prisma)).resolves.toMatchObject({ ok: false });
  });
});

describe('the trusted certificates on the settings page', () => {
  it('are read back with what the page lists of each', async () => {
    await saveConnection('localhost', server.certificate);

    const config = await caller.integrations.auth.getLdapConfig();

    // Stored trimmed, as the form schema reads the field.
    expect(config.trustedCertificates).toBe(server.certificate.trim());
    expect(config.trustedCertificateDetails).toEqual([
      { subject: 'CN=localhost', validTo: expect.any(String), expired: false, selfSigned: true },
    ]);
  });

  it('a value that is not certificates is refused and nothing of the save is written', async () => {
    await saveConnection('localhost', server.certificate);

    await expect(saveConnection('dc.other.test', NOT_A_CERTIFICATE)).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    const config = await caller.integrations.auth.getLdapConfig();
    expect(config.url).toBe(`ldaps://localhost:${server.port}`);
    // Stored trimmed, as the form schema reads the field.
    expect(config.trustedCertificates).toBe(server.certificate.trim());
  });

  it('every writer refuses it: the generic one too, as an import or config.set reaches it', async () => {
    await expect(
      saveConfigs(prisma, [{ key: 'auth.ldap.trustedCertificates', value: NOT_A_CERTIFICATE, encrypt: true }])
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: expect.stringContaining('Certificati non validi') });
    expect(await prisma.appConfig.findUnique({ where: { key: 'auth.ldap.trustedCertificates' } })).toBeNull();
  });

  it('an empty field removes them, a field emptied down to a newline too', async () => {
    await saveConnection('localhost', server.certificate);

    await saveConnection('localhost', '\n  ');

    expect(await prisma.appConfig.findUnique({ where: { key: 'auth.ldap.trustedCertificates' } })).toBeNull();
  });
});
