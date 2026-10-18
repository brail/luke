/**
 * `integrations.google.exchangeOAuthCode` stores the refresh token and the account address as one
 * outcome.
 *
 * Only the calendar scope is requested, so Google's userinfo answer can carry no address. The
 * client turned that into `''`, which the registry refuses (`.email()`): the save failed after the
 * new refresh token was already stored, the audit row was skipped, and the settings page kept
 * showing the previous account's address. A missing address now removes the stored one.
 *
 * Missing client credentials and an answer without a refresh token are refusals the admin can act
 * on, so they come back as PRECONDITION_FAILED with their message instead of a masked 500.
 *
 * A code is exchanged only with the `state` of a flow the same user started (#143): one use, ten
 * minutes, a stale tab's state refused without ending the current flow, and the IP and account
 * buckets checked first (CLAUDE.md rule 12).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import * as calendar from '@luke/calendar';
import type { PrismaClient } from '@luke/db';

import { deleteConfig, getConfig, saveConfig } from '../src/lib/configManager';
import { enforceRateLimit } from '../src/lib/ratelimit';
import { resolveRateLimitPolicy } from '../src/lib/rateLimitPolicy';

import { createCallerAs, createCallerWithSession, createTestUser, setupTestDb } from './helpers';

type Caller = Awaited<ReturnType<typeof createCallerAs>>;

const REDIRECT_URI = 'https://luke.example.com/cb';
const STATE_REFUSED = { code: 'BAD_REQUEST', message: "Autorizzazione scaduta o non valida: ricollega l'account" };

let prisma: PrismaClient;

beforeEach(async () => {
  prisma = await setupTestDb();
  await saveConfig(prisma, 'integrations.google.oauth.clientId', 'client-id');
  await saveConfig(prisma, 'integrations.google.oauth.clientSecret', 'client-secret', true);
  await saveConfig(prisma, 'integrations.google.oauth.userEmail', 'previous@example.com');
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Google's answer to the code exchange. Spied on the package namespace: `appRouter` is loaded by
 * the setup file before any `vi.mock`. */
const googleAnswers = (userEmail: string | null = 'new@example.com') =>
  vi.spyOn(calendar, 'exchangeOAuthCode').mockResolvedValue({ refreshToken: 'new-token', userEmail });

/** Starts a flow as `caller` and returns the `state` its authorization URL carries. */
async function startFlow(caller: Caller) {
  const { url } = await caller.integrations.google.getOAuthUrl({ redirectUri: REDIRECT_URI });
  const state = new URL(url).searchParams.get('state');
  if (!state) throw new Error('the authorization URL carries no state');
  return state;
}

const exchangeWith = (caller: Caller, state: string) =>
  caller.integrations.google.exchangeOAuthCode({ code: 'code', state, redirectUri: REDIRECT_URI });

const exchange = async (userEmail: string | null) => {
  googleAnswers(userEmail);
  const caller = await createCallerAs('admin');
  return exchangeWith(caller, await startFlow(caller));
};

describe('integrations.google.exchangeOAuthCode', () => {
  it('stores the token and the address, and audits the connection', async () => {
    await expect(exchange('new@example.com')).resolves.toEqual({ userEmail: 'new@example.com' });

    expect(await getConfig(prisma, 'integrations.google.oauth.refreshToken', true)).toBe('new-token');
    expect(await getConfig(prisma, 'integrations.google.oauth.userEmail', false)).toBe('new@example.com');
    expect(await prisma.auditLog.count({ where: { action: 'CONFIG_GOOGLE_OAUTH_CONNECT' } })).toBe(1);
  });

  it('with no address in Google’s answer, removes the stored one instead of failing half-way', async () => {
    await expect(exchange(null)).resolves.toEqual({ userEmail: null });

    expect(await getConfig(prisma, 'integrations.google.oauth.refreshToken', true)).toBe('new-token');
    expect(await getConfig(prisma, 'integrations.google.oauth.userEmail', false)).toBeNull();
    expect(await prisma.auditLog.count({ where: { action: 'CONFIG_GOOGLE_OAUTH_CONNECT' } })).toBe(1);
  });

  it('an answer without a refresh token is a precondition failure that stores nothing', async () => {
    vi.spyOn(calendar, 'exchangeOAuthCode').mockRejectedValue(new calendar.MissingRefreshTokenError('none'));
    const caller = await createCallerAs('admin');

    await expect(exchangeWith(caller, await startFlow(caller))).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    expect(await getConfig(prisma, 'integrations.google.oauth.refreshToken', true)).toBeNull();
    expect(await prisma.auditLog.count({ where: { action: 'CONFIG_GOOGLE_OAUTH_CONNECT' } })).toBe(0);
  });
});

describe('integrations.google without client credentials', () => {
  it('refuses both OAuth steps as a precondition failure', async () => {
    await deleteConfig(prisma, 'integrations.google.oauth.clientId');
    const caller = await createCallerAs('admin');
    const redirectUri = 'https://luke.example.com/cb';

    await expect(caller.integrations.google.getOAuthUrl({ redirectUri })).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
    });
    // No flow can start without credentials; the exchange answers that before it looks at the state.
    await expect(
      caller.integrations.google.exchangeOAuthCode({ code: 'code', state: 'no-flow', redirectUri }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
  });
});

describe('integrations.google.exchangeOAuthCode — the OAuth state (#143)', () => {
  it('refuses a state from no flow, or from another user\'s flow, without calling Google', async () => {
    const google = googleAnswers();
    const caller = await createCallerAs('admin');
    const othersState = await startFlow(await createCallerAs('admin'));

    await expect(exchangeWith(caller, 'no-flow-started')).rejects.toMatchObject(STATE_REFUSED);
    await expect(exchangeWith(caller, othersState)).rejects.toMatchObject(STATE_REFUSED);
    expect(google).not.toHaveBeenCalled();
  });

  it('refuses a state older than ten minutes', async () => {
    const google = googleAnswers();
    const caller = await createCallerAs('admin');
    const state = await startFlow(caller);
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 11 * 60 * 1000);

    await expect(exchangeWith(caller, state)).rejects.toMatchObject(STATE_REFUSED);
    expect(google).not.toHaveBeenCalled();
  });

  it('exchanges a state once: a replay is refused', async () => {
    const google = googleAnswers();
    const caller = await createCallerAs('admin');
    const state = await startFlow(caller);

    await expect(exchangeWith(caller, state)).resolves.toEqual({ userEmail: 'new@example.com' });
    await expect(exchangeWith(caller, state)).rejects.toMatchObject(STATE_REFUSED);
    expect(google).toHaveBeenCalledTimes(1);
  });

  it('refuses a stale tab\'s state and leaves the current flow alone', async () => {
    const google = googleAnswers();
    const caller = await createCallerAs('admin');
    const stale = await startFlow(caller);
    const current = await startFlow(caller);

    await expect(exchangeWith(caller, stale)).rejects.toMatchObject(STATE_REFUSED);
    await expect(exchangeWith(caller, current)).resolves.toEqual({ userEmail: 'new@example.com' });
    expect(google).toHaveBeenCalledTimes(1);
  });

  it('two concurrent exchanges of one state make one call to Google', async () => {
    const google = googleAnswers();
    const caller = await createCallerAs('admin');
    const state = await startFlow(caller);

    const outcomes = await Promise.allSettled([exchangeWith(caller, state), exchangeWith(caller, state)]);

    expect(outcomes.map(outcome => outcome.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(google).toHaveBeenCalledTimes(1);
  });

  it.each(['googleOAuthExchange', 'configMutations'] as const)('a full %s bucket refuses the exchange before Google', async bucket => {
    const google = googleAnswers();
    const { session } = await createTestUser('admin');
    const caller = createCallerWithSession(session);
    const state = await startFlow(caller);
    // The test context's address (`createTestContext`) for the IP bucket, the account for the other.
    const key = bucket === 'googleOAuthExchange' ? '127.0.0.1' : session.user.id;
    const policy = await resolveRateLimitPolicy(bucket, prisma);
    for (let i = 0; i < policy.max; i++) enforceRateLimit(bucket, key, policy);

    await expect(exchangeWith(caller, state)).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS' });
    expect(google).not.toHaveBeenCalled();
  });
});
