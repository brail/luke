/**
 * Configuration an admin still has to complete is a precondition (4xx), not a server fault.
 *
 * Production masks the text of every 5xx, so these procedures used to show the admin
 * "Internal server error" where the code had written what to fix: the NAV connection test
 * (`CONFIG_ERROR` mapped to 500), the SMTP test (the incomplete-configuration error swallowed into
 * a generic `SMTP_ERROR`), and the LDAP search test (no completeness check, so the bind failed as
 * a 500).
 */

import { randomUUID } from 'crypto';

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import * as nav from '@luke/nav';

import { saveConfig } from '../src/lib/configManager';

import { createCallerAs, setupTestDb } from './helpers';

let prisma: Awaited<ReturnType<typeof setupTestDb>>;

beforeEach(async () => {
  prisma = await setupTestDb();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('incomplete configuration reaches the admin as a 4xx', () => {
  it('NAV connection test', async () => {
    const caller = await createCallerAs('admin');

    await expect(caller.integrations.nav.testConnection()).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: expect.stringMatching(/^Configurazione NAV incompleta/),
    });
  });

  it('NAV preview, connecting to nothing', async () => {
    const caller = await createCallerAs('admin');
    const getPool = vi.spyOn(nav, 'getPool');

    await expect(caller.integrations.nav.sync.preview({ entity: 'brand' })).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: expect.stringMatching(/^Configurazione NAV incompleta/),
    });
    expect(getPool).not.toHaveBeenCalled();
  });

  it('NAV manual sync, spending none of its one attempt', async () => {
    const caller = await createCallerAs('admin');
    const incomplete = {
      code: 'PRECONDITION_FAILED',
      message: expect.stringMatching(/^Configurazione NAV incompleta/),
    };

    await expect(caller.integrations.nav.sync.run({ entity: 'brand' })).rejects.toMatchObject(incomplete);
    await expect(caller.integrations.nav.sync.run({ entity: 'brand' })).rejects.toMatchObject(incomplete);
  });

  it('a failure to read the NAV configuration is not reported as an incomplete one', async () => {
    const caller = await createCallerAs('admin');
    vi.spyOn(nav, 'getNavDbConfig').mockRejectedValueOnce(new Error('database unreachable'));

    await expect(caller.integrations.nav.testConnection()).rejects.toThrow('database unreachable');
  });

  it('SMTP test', async () => {
    const caller = await createCallerAs('admin');

    await expect(caller.integrations.mail.test({})).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: expect.stringMatching(/^Configurazione SMTP incompleta/),
    });
  });

  it('LDAP search test', async () => {
    await saveConfig(prisma, 'auth.ldap.enabled', 'true');
    await saveConfig(prisma, 'auth.ldap.url', 'ldap://dc.example.com', true);
    const caller = await createCallerAs('admin');

    await expect(caller.integrations.auth.testLdapSearch({ username: 'someone' })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'Configurazione LDAP incompleta per il test',
    });
  });

  it('admin-initiated email verification for a user that does not exist', async () => {
    const caller = await createCallerAs('admin');

    // Used to be wrapped into a 500 carrying 'Utente non trovato', which production masks.
    await expect(caller.auth.requestEmailVerificationAdmin({ userId: randomUUID() })).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'Utente non trovato',
    });
  });
});
