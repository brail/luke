/**
 * `config.getMultiple` read each key through `getConfig`, which answers `null` for a key not stored
 * and the stored text for an encrypted one: every key came back `found`, so the import dialog marked
 * new keys as updates, and an encrypted value came back as stored. It now reads the rows once.
 */

import { beforeAll, describe, expect, it } from 'vitest';

import { createCallerAs, setupTestDb } from './helpers';

let caller: Awaited<ReturnType<typeof createCallerAs>>;

beforeAll(async () => {
  await setupTestDb();
  caller = await createCallerAs('admin');
  await caller.config.set({ key: 'app.name', value: 'Luke', encrypt: false });
  await caller.config.set({ key: 'auth.ldap.bindPassword', value: 's3cret', encrypt: true });
});

describe('config.getMultiple', () => {
  it('answers each key in the order asked: missing, encrypted, plain', async () => {
    const missing = 'app.notStoredAnywhere';

    expect(await caller.config.getMultiple({ keys: [missing, 'auth.ldap.bindPassword', 'app.name', 'app.name'] })).toEqual([
      { key: missing, value: null, found: false },
      { key: 'auth.ldap.bindPassword', value: null, found: true },
      { key: 'app.name', value: 'Luke', found: true },
      { key: 'app.name', value: 'Luke', found: true },
    ]);
  });
});
