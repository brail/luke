import { describe, it, expect, beforeEach, vi } from 'vitest';

import { syncCalendarAcl } from '../acl.js';

/**
 * The ACL is what keeps a season calendar from being readable by people who should not
 * see it. A reconciliation error raises no exception: it just leaves one reader too many,
 * silently.
 */
const { acl, getWorkspaceDomain } = vi.hoisted(() => ({
  acl: {
    insert: vi.fn(),
    delete: vi.fn(),
    list: vi.fn(),
    get: vi.fn(),
    update: vi.fn(),
  },
  getWorkspaceDomain: vi.fn(() => 'example.com'),
}));

vi.mock('../client.js', () => ({
  getClient: () => ({ acl }),
  getWorkspaceDomain,
}));

type Rule = { id: string; role: string; etag?: string; scope: { type: string; value?: string } };

/** A user-scoped reader rule, with the id Google gives it. */
function reader(email: string): Rule {
  return { id: `user:${email}`, role: 'reader', scope: { type: 'user', value: email } };
}

/** Builds one `acl.list` page the way the Google API returns it. */
function page(items: Rule[], nextPageToken?: string) {
  return { data: { items, nextPageToken } };
}

function googleError(status: number, reason?: string) {
  return Object.assign(new Error(`status ${status}`), {
    code: status,
    response: { data: { error: { errors: reason ? [{ reason }] : [] } } },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  acl.insert.mockResolvedValue({});
  acl.delete.mockResolvedValue({});
  acl.update.mockResolvedValue({});
  // No alias: an address the ACL does not list has no rule.
  acl.get.mockRejectedValue(googleError(404));
});

describe('syncCalendarAcl', () => {
  it('adds the missing ones and removes the extra ones', async () => {
    acl.list.mockResolvedValue(page([reader('resta@example.com'), reader('esce@example.com')]));

    const result = await syncCalendarAcl('cal-1', [
      'resta@example.com',
      'entra@example.com',
    ]);

    expect(acl.insert).toHaveBeenCalledTimes(1);
    expect(acl.insert).toHaveBeenCalledWith({
      calendarId: 'cal-1',
      sendNotifications: true,
      requestBody: {
        role: 'reader',
        scope: { type: 'user', value: 'entra@example.com' },
      },
    });

    expect(acl.delete).toHaveBeenCalledTimes(1);
    expect(acl.delete).toHaveBeenCalledWith({
      calendarId: 'cal-1',
      ruleId: 'user:esce@example.com',
    });
    expect(result).toMatchObject({ added: 1, removed: 1, inserted: ['entra@example.com'], errors: [] });
  });

  it('touches nothing when the state already matches', async () => {
    acl.list.mockResolvedValue(page([reader('a@example.com')]));

    await syncCalendarAcl('cal-1', ['a@example.com']);

    // Every expected reader is listed: Google is not asked about aliases.
    expect(acl.get).not.toHaveBeenCalled();
    expect(acl.insert).not.toHaveBeenCalled();
    expect(acl.delete).not.toHaveBeenCalled();
  });

  it('empties the readers when the expected list is empty', async () => {
    // Critical case: a function with no members must stay without readers, not keep
    // the previous ones.
    acl.list.mockResolvedValue(page([reader('a@example.com'), reader('b@example.com')]));

    await syncCalendarAcl('cal-1', []);

    expect(acl.delete).toHaveBeenCalledTimes(2);
    expect(acl.insert).not.toHaveBeenCalled();
  });

  it('compares addresses ignoring case', async () => {
    // Adding and removing the same rule in one pass could end with the reader removed.
    acl.list.mockResolvedValue(page([reader('mario.rossi@example.com')]));

    await syncCalendarAcl('cal-1', ['Mario.Rossi@Example.com']);

    expect(acl.insert).not.toHaveBeenCalled();
    expect(acl.delete).not.toHaveBeenCalled();
  });

  it('leaves an expected reader who already holds a writer or owner rule as they are', async () => {
    // An insert on the same scope would replace the rule: the calendar's owner (often an admin,
    // hence an expected reader) would be downgraded to reader.
    acl.list.mockResolvedValue(page([
      { id: 'user:owner@example.com', role: 'owner', scope: { type: 'user', value: 'owner@example.com' } },
      { id: 'user:w@example.com', role: 'writer', scope: { type: 'user', value: 'w@example.com' } },
    ]));

    const result = await syncCalendarAcl('cal-1', ['Owner@example.com', 'w@example.com']);

    expect(acl.insert).not.toHaveBeenCalled();
    expect(acl.delete).not.toHaveBeenCalled();
    expect(result).toMatchObject({ added: 0, removed: 0, errors: [] });
  });

  it('removes a rule by the id Google gives it, not one rebuilt from the address', async () => {
    acl.list.mockResolvedValue(page([
      { id: 'user:Old.Reader@example.com', role: 'reader', scope: { type: 'user', value: 'old.reader@example.com' } },
    ]));

    await syncCalendarAcl('cal-1', []);

    expect(acl.delete).toHaveBeenCalledWith({ calendarId: 'cal-1', ruleId: 'user:Old.Reader@example.com' });
  });

  it('reads every page of the ACL', async () => {
    // Google pages the ACL: a reader on a later page must be revoked too, and a reader already
    // there must not be added again.
    acl.list
      .mockResolvedValueOnce(page([reader('a@example.com')], 'next'))
      .mockResolvedValueOnce(page([reader('b@example.com'), reader('gone@example.com')]));

    await syncCalendarAcl('cal-1', ['a@example.com', 'b@example.com']);

    expect(acl.list).toHaveBeenNthCalledWith(1, { calendarId: 'cal-1', maxResults: 250, pageToken: undefined });
    expect(acl.list).toHaveBeenNthCalledWith(2, { calendarId: 'cal-1', maxResults: 250, pageToken: 'next' });
    expect(acl.insert).not.toHaveBeenCalled();
    expect(acl.delete).toHaveBeenCalledTimes(1);
    expect(acl.delete).toHaveBeenCalledWith({ calendarId: 'cal-1', ruleId: 'user:gone@example.com' });
  });

  it('one refused change does not stop the others, and is returned', async () => {
    const refused = googleError(400, 'invalid');
    acl.list.mockResolvedValue(page([reader('gone@example.com')]));
    acl.insert.mockImplementation(async ({ requestBody }: { requestBody: { scope: { value: string } } }) => {
      if (requestBody.scope.value === 'bad@external.test') throw refused;
      return {};
    });

    const result = await syncCalendarAcl('cal-1', ['bad@external.test', 'good@example.com']);

    expect(acl.insert).toHaveBeenCalledTimes(2);
    expect(acl.delete).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ added: 1, removed: 1, errors: [refused] });
  });

  it('counts a rule already gone (404) as removed', async () => {
    acl.list.mockResolvedValue(page([reader('gone@example.com')]));
    acl.delete.mockRejectedValue(googleError(404));

    const result = await syncCalendarAcl('cal-1', []);

    expect(result).toMatchObject({ removed: 1, errors: [] });
  });

  it('retries a change Google refuses for a rate limit', async () => {
    acl.list.mockResolvedValue(page([]));
    acl.insert.mockRejectedValueOnce(googleError(403, 'rateLimitExceeded')).mockResolvedValueOnce({});

    const result = await syncCalendarAcl('cal-1', ['a@example.com']);

    expect(acl.insert).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ added: 1, errors: [] });
  });
});

/**
 * A Google ACL that resolves aliases the way the real one was observed to (#243): a user rule is
 * stored under the account's primary address whatever address the insert names; `get` of an alias
 * answers 200 echoing the alias, with the role and `etag` of the account's rule, or 404 when the
 * account has none. `etag`s are opaque and change on every write.
 */
function aliasingAcl(aliases: Record<string, string>, rules: Record<string, string> = {}, resolvesAliases = true) {
  const stored = new Map(Object.entries(rules).map(([primary, role]) => [primary, { role, etag: `"seed-${primary}"` }]));
  let version = 0;
  const primaryOf = (address: string) => aliases[address.toLowerCase()] ?? address.toLowerCase();
  acl.list.mockImplementation(async () =>
    page([...stored].map(([primary, r]) => ({ id: `user:${primary}`, role: r.role, etag: r.etag, scope: { type: 'user', value: primary } })))
  );
  acl.get.mockImplementation(async ({ ruleId }: { ruleId: string }) => {
    const address = ruleId.slice('user:'.length);
    const rule = resolvesAliases || !(address in aliases) ? stored.get(primaryOf(address)) : undefined;
    if (!rule) throw googleError(404);
    return { data: { id: ruleId, role: rule.role, etag: rule.etag, scope: { type: 'user', value: address } } };
  });
  acl.insert.mockImplementation(async ({ requestBody }: { requestBody: { role: string; scope: { value: string } } }) => {
    stored.set(primaryOf(requestBody.scope.value), { role: requestBody.role, etag: `"v${++version}"` });
    return { data: { id: `user:${requestBody.scope.value}`, role: requestBody.role, scope: requestBody.scope } };
  });
  acl.delete.mockImplementation(async ({ ruleId }: { ruleId: string }) => {
    stored.delete(ruleId.slice('user:'.length));
  });
  return { stored };
}

/** Runs one pass and reports what it changed. */
async function pass(expected: string[]) {
  vi.clearAllMocks();
  const result = await syncCalendarAcl('cal-1', expected);
  return { inserts: acl.insert.mock.calls.length, deletes: acl.delete.mock.calls.length, result };
}

describe('alias addresses (#243)', () => {
  const ALIASES = { 'a1@example.com': 'box@example.com', 'a2@example.com': 'box@example.com' };

  it('two aliases of an account that already reads → nothing inserted or removed, pass after pass', async () => {
    aliasingAcl(ALIASES, { 'box@example.com': 'reader' });

    for (let i = 0; i < 2; i++) {
      expect(await pass(['a1@example.com', 'a2@example.com'])).toMatchObject({ inserts: 0, deletes: 0, result: { errors: [] } });
    }
  });

  it('a first-time alias is inserted once, with the share email, then converges', async () => {
    const { stored } = aliasingAcl(ALIASES);

    const first = await pass(['a1@example.com']);
    expect(first).toMatchObject({ inserts: 1, deletes: 0, result: { inserted: ['a1@example.com'] } });
    expect(acl.insert).toHaveBeenCalledWith(expect.objectContaining({ sendNotifications: true }));
    expect(await pass(['a1@example.com'])).toMatchObject({ inserts: 0, deletes: 0, result: { inserted: [] } });
    expect([...stored.keys()]).toEqual(['box@example.com']);
  });

  it('two aliases of an account with no rule → one rule after the first pass, then nothing', async () => {
    const { stored } = aliasingAcl(ALIASES);

    expect(await pass(['a1@example.com', 'a2@example.com'])).toMatchObject({ inserts: 2, deletes: 0 });
    expect([...stored.keys()]).toEqual(['box@example.com']);
    expect(await pass(['a1@example.com', 'a2@example.com'])).toMatchObject({ inserts: 0, deletes: 0 });
  });

  it('an alias no longer expected → the account rule is removed', async () => {
    const { stored } = aliasingAcl(ALIASES, { 'box@example.com': 'reader' });

    expect(await pass([])).toMatchObject({ inserts: 0, deletes: 1 });
    expect(stored.size).toBe(0);
  });

  it.each([
    [['a1@example.com', 'box@example.com'], 0],
    [['a1@example.com'], 0],
    [['box@example.com'], 0],
    [[], 1],
  ])('alias and primary: expected %j → %i removed', async (expected, deletes) => {
    aliasingAcl(ALIASES, { 'box@example.com': 'reader' });

    expect(await pass(expected)).toMatchObject({ inserts: 0, deletes });
  });

  it.each(['writer', 'owner'])('an alias of an account holding %s → left as it is', async role => {
    aliasingAcl(ALIASES, { 'box@example.com': role });

    expect(await pass(['a1@example.com'])).toMatchObject({ inserts: 0, deletes: 0 });
  });

  it('an alias of an account that only sees free/busy → inserted as reader', async () => {
    const { stored } = aliasingAcl(ALIASES, { 'box@example.com': 'freeBusyReader' });

    expect(await pass(['a1@example.com'])).toMatchObject({ inserts: 1 });
    expect(stored.get('box@example.com')?.role).toBe('reader');
  });

  // Residual (b) of the plan: the flap `reconcileGoogleReaders` warns about.
  it('Google no longer resolving aliases → the alias is inserted and the primary removed, and reported as inserted', async () => {
    aliasingAcl(ALIASES, { 'box@example.com': 'reader' }, false);

    expect(await pass(['a1@example.com'])).toMatchObject({ inserts: 1, deletes: 1, result: { inserted: ['a1@example.com'] } });
  });

  it('an expected address listed under itself without read access → inserted, Google not asked', async () => {
    acl.list.mockResolvedValue(page([{ id: 'user:fb@example.com', role: 'freeBusyReader', scope: { type: 'user', value: 'fb@example.com' } }]));

    await syncCalendarAcl('cal-1', ['fb@example.com']);

    expect(acl.get).not.toHaveBeenCalled();
    expect(acl.insert).toHaveBeenCalledTimes(1);
  });

  it('an alias moved to another account → access moves with it', async () => {
    const aliases: Record<string, string> = { 'al@example.com': 'old@example.com' };
    const { stored } = aliasingAcl(aliases, { 'old@example.com': 'reader' });
    expect(await pass(['al@example.com'])).toMatchObject({ inserts: 0, deletes: 0 });

    aliases['al@example.com'] = 'new@example.com';
    expect(await pass(['al@example.com'])).toMatchObject({ inserts: 1, deletes: 1 });
    expect([...stored.keys()]).toEqual(['new@example.com']);
    expect(await pass(['al@example.com'])).toMatchObject({ inserts: 0, deletes: 0 });
  });
});

describe('alias lookup in doubt: removal goes on', () => {
  const box = (etag: string): Rule => ({ ...reader('box@example.com'), etag });
  const stranger: Rule = { ...reader('gone@example.com'), etag: '"f"' };
  const aliasAnswer = (etag?: string) => ({ data: { id: 'user:a1@example.com', role: 'reader', etag, scope: { type: 'user', value: 'a1@example.com' } } });

  it('two listed rules share the alias etag → both kept, another unexpected reader still removed', async () => {
    const twin: Rule = { ...reader('twin@example.com'), etag: '"e"' };
    acl.list.mockResolvedValue(page([box('"e"'), twin, stranger]));
    acl.get.mockResolvedValue(aliasAnswer('"e"'));

    const result = await syncCalendarAcl('cal-1', ['a1@example.com']);

    expect(acl.insert).not.toHaveBeenCalled();
    expect(acl.delete).toHaveBeenCalledTimes(1);
    expect(acl.delete).toHaveBeenCalledWith({ calendarId: 'cal-1', ruleId: 'user:gone@example.com' });
    expect(result.errors).toEqual([]);
  });

  it.each([
    ['an etag no listed rule carries', () => acl.get.mockResolvedValue(aliasAnswer('"other"'))],
    ['no etag', () => acl.get.mockResolvedValue(aliasAnswer(undefined))],
    ['an empty etag', () => acl.get.mockResolvedValue(aliasAnswer(''))],
    ['a failing lookup', () => acl.get.mockRejectedValue(googleError(403, 'forbidden'))],
  ])('%s → nothing inserted, every unexpected reader removed, reported', async (_case, answer) => {
    acl.list.mockResolvedValue(page([box('"e"'), stranger]));
    answer();

    for (let i = 0; i < 2; i++) {
      vi.clearAllMocks();
      const result = await syncCalendarAcl('cal-1', ['a1@example.com']);

      expect(acl.insert).not.toHaveBeenCalled();
      expect(acl.delete).toHaveBeenCalledTimes(2);
      expect(result.errors).toHaveLength(1);
    }
  });
});

describe('rules Luke does not manage', () => {
  it('reports them and never changes them', async () => {
    acl.list.mockResolvedValue(page([
      reader('a@example.com'),
      { id: 'user:owner@example.com', role: 'owner', scope: { type: 'user', value: 'owner@example.com' } },
      // The Workspace domain rule is pinned, not reported.
      { id: 'domain:example.com', role: 'freeBusyReader', scope: { type: 'domain', value: 'example.com' } },
      { id: 'user:none@example.com', role: 'none', scope: { type: 'user', value: 'none@example.com' } },
      { id: 'group:team@example.com', role: 'reader', scope: { type: 'group', value: 'team@example.com' } },
      { id: 'default', role: 'reader', scope: { type: 'default' } },
      { id: 'domain:other.test', role: 'reader', scope: { type: 'domain', value: 'other.test' } },
      { id: 'user:w@example.com', role: 'writer', scope: { type: 'user', value: 'w@example.com' } },
      { id: 'user:fb@example.com', role: 'freeBusyReader', scope: { type: 'user', value: 'fb@example.com' } },
    ]));

    const result = await syncCalendarAcl('cal-1', ['a@example.com']);

    expect(result.unmanaged).toEqual([
      { role: 'reader', scopeType: 'group' },
      { role: 'reader', scopeType: 'default' },
      { role: 'reader', scopeType: 'domain' },
      { role: 'writer', scopeType: 'user' },
      { role: 'freeBusyReader', scopeType: 'user' },
    ]);
    expect(acl.insert).not.toHaveBeenCalled();
    expect(acl.delete).not.toHaveBeenCalled();
  });

  it('reports the owners when there is more than one', async () => {
    acl.list.mockResolvedValue(page([
      { id: 'user:luke@example.com', role: 'owner', scope: { type: 'user', value: 'luke@example.com' } },
      { id: 'user:extra@example.com', role: 'owner', scope: { type: 'user', value: 'extra@example.com' } },
    ]));

    const result = await syncCalendarAcl('cal-1', []);

    expect(result.unmanaged).toEqual([
      { role: 'owner', scopeType: 'user' },
      { role: 'owner', scopeType: 'user' },
    ]);
    expect(acl.delete).not.toHaveBeenCalled();
  });
});

describe('the Workspace domain rule', () => {
  const domainRule = (role: string): Rule => ({ id: 'domain:example.com', role, scope: { type: 'domain', value: 'example.com' } });

  it('is downgraded to freeBusyReader when more permissive', async () => {
    // Google applies the MOST permissive rule among the matching ones: a domain rule
    // with `writer` would override the per-user `reader` grants.
    acl.list.mockResolvedValue(page([domainRule('writer')]));

    await syncCalendarAcl('cal-1', []);

    expect(acl.update).toHaveBeenCalledWith({
      calendarId: 'cal-1',
      ruleId: 'domain:example.com',
      requestBody: {
        role: 'freeBusyReader',
        scope: { type: 'domain', value: 'example.com' },
      },
    });
  });

  it.each(['freeBusyReader', 'none'])('is not touched at %s', async role => {
    acl.list.mockResolvedValue(page([domainRule(role)]));

    await syncCalendarAcl('cal-1', []);

    expect(acl.update).not.toHaveBeenCalled();
  });

  it('needs nothing when there is no domain rule', async () => {
    acl.list.mockResolvedValue(page([]));

    await syncCalendarAcl('cal-1', []);

    expect(acl.update).not.toHaveBeenCalled();
  });

  it('a refused downgrade is thrown, after the readers are reconciled', async () => {
    // A calendar the whole domain may edit must not count as reconciled.
    const refused = googleError(400, 'invalid');
    acl.list.mockResolvedValue(page([domainRule('writer')]));
    acl.update.mockRejectedValue(refused);

    await expect(syncCalendarAcl('cal-1', ['a@example.com'])).rejects.toBe(refused);
    expect(acl.insert).toHaveBeenCalledTimes(1);
  });
});
