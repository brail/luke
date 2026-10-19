/**
 * An API session ends on sign-out and never outlives 12 h from its login.
 *
 * `auth.logout` revokes every session of the caller (`tokenVersion`), so the bearer it was called
 * with stops working wherever a bearer is verified: a tRPC procedure, a Fastify route, the refresh.
 * Every bearer carries `authTime`, the login it descends from: the login sets it, the refresh copies
 * it, and `createUserSession` refuses a bearer without a valid one, or past 12 h from it, whatever
 * its `exp` says. The refresh also refuses a bearer whose version is no longer the user's, so a
 * refresh that passed authentication before a sign-out cannot mint a token at the new version.
 *
 * The bearer tests go through `createContext`, as a real request does: a hand-built session skips
 * `createUserSession`, which is where the limit lives.
 */
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { SESSION_ABSOLUTE_LIFETIME_SECONDS } from '@luke/core';
import type { PrismaClient, User } from '@luke/db';

import { createToken, createUserSession } from '../src/lib/auth';
import { signJWT, verifyJWT } from '../src/lib/jwt';
import * as ldapAuth from '../src/lib/ldapAuth';
import { writeMaintenanceState, type MaintenanceModeState } from '../src/lib/maintenanceMode';
import { rateLimitStore } from '../src/lib/ratelimit';
import { createContext } from '../src/lib/trpc';
import { appRouter } from '../src/routers/index';
import brandLogoRoutes from '../src/routes/brandLogo.routes';

import { TEST_USER_PASSWORD, createSilentLogger, createTestContext, createTestUser, setupTestDb } from './helpers';

import type { UserSession } from '../src/lib/auth';

const HOUR = 60 * 60;
const T0 = new Date('2030-01-15T09:00:00.000Z');
const T0_SECONDS = T0.getTime() / 1000;

const INACTIVE: MaintenanceModeState = {
  status: 'INACTIVE',
  scheduledAt: null,
  activatedAt: null,
  message: null,
  forceLogout: false,
  warningLeadMinutes: [],
  warningsSent: [],
  activatedByUserId: null,
  notifyByEmail: false,
};

let prisma: PrismaClient;
let app: FastifyInstance;
let brandId: string;
let ip = 0;

beforeAll(async () => {
  prisma = await setupTestDb();
  app = fastify({ logger: false });
  // As in `server.ts`: a bearer refused while building its session clears the legacy cookie.
  await app.register(cookie);
  await app.register(multipart);
  await app.register(brandLogoRoutes, { prisma });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  prisma = await setupTestDb();
  rateLimitStore.clear();
  brandId = (await prisma.brand.create({ data: { code: 'SESSION_LIFE', name: 'Session Life' } })).id;
});

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await writeMaintenanceState(prisma, INACTIVE);
});

const nowSeconds = () => Math.floor(Date.now() / 1000);

/** A caller whose session comes from `token` exactly as a request's does, from its own IP. */
async function callerWithBearer(token: string) {
  const ctx = await createContext({
    prisma,
    // Only what `createContext` and `authenticateRequest` read: the header, the IP, the logger and
    // the cookie clearing on a refused token. A whole Fastify request is not needed for that.
    req: {
      headers: { authorization: `Bearer ${token}` },
      ip: `10.31.0.${++ip}`,
      log: createSilentLogger(),
    } as unknown as FastifyRequest,
    res: { clearCookie: () => undefined } as unknown as FastifyReply,
  });
  return appRouter.createCaller(ctx);
}

/**
 * The status of an admin's logo upload without a file: 400 past authentication, 401 refused.
 * In-process (`inject`), as Fastify recommends: over a real ephemeral port, a full-suite run once
 * got a 404 that no branch of this route answers.
 */
async function uploadStatus(token: string) {
  const response = await app.inject({
    method: 'POST',
    url: `/upload/brand-logo/${brandId}`,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'multipart/form-data; boundary=b' },
    payload: '--b\r\nContent-Disposition: form-data; name="note"\r\n\r\nno file\r\n--b--\r\n',
  });
  return response.statusCode;
}

/** A bearer as any earlier signer could have produced it: `exp` 8 h ahead, `authTime` as given. */
function bearerWithAuthTime(user: User, authTime: number | undefined) {
  return signJWT(
    { userId: user.id, email: user.email, username: user.username, role: user.role, tokenVersion: 0, authTime },
    { expiresIn: '8h' }
  );
}

/** A caller for a hand-built `session`, from its own IP. */
function createCallerWithSessionFromIp(session: UserSession) {
  const ctx = createTestContext(session);
  Object.assign(ctx.req, { ip: `10.33.0.${++ip}` });
  return appRouter.createCaller(ctx);
}

function login(username: string, password = TEST_USER_PASSWORD) {
  const ctx = createTestContext(null);
  Object.assign(ctx.req, { ip: `10.32.0.${++ip}` });
  return appRouter.createCaller(ctx).auth.login({ username, password });
}

describe('auth.logout', () => {
  it('ends the bearer it was called with on tRPC, on a Fastify route and on refresh', async () => {
    const { user } = await createTestUser('admin');
    const token = createToken(user, nowSeconds());
    expect(await uploadStatus(token)).toBe(400);

    await expect((await callerWithBearer(token)).auth.logout()).resolves.toEqual({ success: true });

    await expect((await callerWithBearer(token)).me.get()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(await uploadStatus(token)).toBe(401);
    await expect((await callerWithBearer(token)).auth.refreshToken()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    const row = await prisma.auditLog.findFirst({ where: { action: 'AUTH_LOGOUT', targetId: user.id } });
    expect(row).toMatchObject({ actorId: user.id, result: 'SUCCESS' });
  });

  it('ends every session of the user, not only the one it was called from', async () => {
    const { user } = await createTestUser('editor');
    const [first, second] = [createToken(user, nowSeconds()), createToken(user, nowSeconds() - HOUR)];

    await (await callerWithBearer(first)).auth.logout();

    await expect((await callerWithBearer(second)).me.get()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  describe('during an active maintenance window', () => {
    beforeEach(async () => {
      await writeMaintenanceState(prisma, { ...INACTIVE, status: 'ACTIVE', activatedAt: new Date().toISOString() });
    });

    it.each(['editor', 'viewer'] as const)('is unavailable to %s, whose session stays', async role => {
      const { user } = await createTestUser(role);
      const token = createToken(user, nowSeconds());

      await expect((await callerWithBearer(token)).auth.logout()).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });

      expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).tokenVersion).toBe(0);
    });

    it('works for the admin, who bypasses maintenance', async () => {
      const { user } = await createTestUser('admin');

      await expect((await callerWithBearer(createToken(user, nowSeconds()))).auth.logout()).resolves.toEqual({ success: true });
    });
  });
});

describe('auth.refreshToken against a concurrent sign-out', () => {
  it('refuses a refresh that passed authentication before the sign-out', async () => {
    const { session } = await createTestUser('editor');
    let reached!: () => void;
    const reachedRead = new Promise<void>(resolve => (reached = resolve));
    let release!: () => void;
    const released = new Promise<void>(resolve => (release = resolve));
    const findUnique = prisma.user.findUnique.bind(prisma.user);
    vi.spyOn(prisma.user, 'findUnique').mockImplementation(
      // The spy keeps the delegate's own signature. It holds the refresh's own read of the user (the
      // only one selecting `username`) until the sign-out has committed; every other read passes.
      (async (args: { select?: { username?: boolean } }) => {
        if (args.select?.username) {
          reached();
          await released;
        }
        return findUnique(args as never);
      }) as never
    );

    const refresh = createCallerWithSessionFromIp(session).auth.refreshToken();
    await reachedRead;
    await createCallerWithSessionFromIp(session).auth.logout();
    release();

    await expect(refresh).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('refuses a session without authTime', async () => {
    const { session } = await createTestUser('editor');
    const withoutAuthTime: UserSession = { user: { ...session.user, authTime: undefined } };

    await expect(createCallerWithSessionFromIp(withoutAuthTime).auth.refreshToken()).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });
});

describe('the 12 h limit on a bearer', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
  });

  it('accepts a bearer until 12 h from its login and refuses it from then on, whatever its exp', async () => {
    const { user } = await createTestUser('admin');
    const token = bearerWithAuthTime(user, T0_SECONDS - SESSION_ABSOLUTE_LIFETIME_SECONDS + 1);

    await expect((await callerWithBearer(token)).me.get()).resolves.toMatchObject({ id: user.id });
    expect(await uploadStatus(token)).toBe(400);

    vi.setSystemTime(T0.getTime() + 1000);
    await expect((await callerWithBearer(token)).me.get()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(await uploadStatus(token)).toBe(401);

    vi.setSystemTime(T0.getTime() + 2000);
    expect(createUserSession(token)).toBeNull();
  });

  it.each([
    ['no authTime', undefined],
    ['a non-finite one', Number.NaN],
    ['one in the future beyond the clock tolerance', T0_SECONDS + 60],
  ])('refuses a bearer with %s', async (_label, authTime) => {
    const { user } = await createTestUser('admin');
    const token = bearerWithAuthTime(user, authTime);

    await expect((await callerWithBearer(token)).me.get()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(await uploadStatus(token)).toBe(401);
  });

  it('accepts one a few seconds ahead, within the clock tolerance', async () => {
    const { user } = await createTestUser('admin');

    expect(createUserSession(bearerWithAuthTime(user, T0_SECONDS + 3))).not.toBeNull();
  });

  it('signs exp at 8 h, or at 12 h from the login when that comes first', async () => {
    const { user } = await createTestUser('admin');

    expect(verifyJWT(createToken(user, T0_SECONDS))?.exp).toBe(T0_SECONDS + 8 * HOUR);
    expect(verifyJWT(createToken(user, T0_SECONDS - 10 * HOUR))?.exp).toBe(T0_SECONDS + 2 * HOUR);
  });
});

describe('authTime from the login', () => {
  it('is set by a LOCAL login and kept by the refresh', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    const { user } = await createTestUser('editor');

    const { token } = await login(user.username);
    expect(verifyJWT(token)?.authTime).toBe(T0_SECONDS);

    vi.setSystemTime(T0.getTime() + 5 * HOUR * 1000);
    const { token: refreshed } = await (await callerWithBearer(token)).auth.refreshToken();
    expect(verifyJWT(refreshed)).toMatchObject({ authTime: T0_SECONDS, exp: T0_SECONDS + 12 * HOUR });
  });

  it('is set by an LDAP login', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    const ldapUser = await prisma.user.create({
      data: { email: 'erin@example.com', username: 'erin', role: 'editor', isActive: true, timezone: 'Europe/Rome' },
    });
    await prisma.identity.create({ data: { userId: ldapUser.id, provider: 'LDAP', providerId: 'erin' } });
    vi.spyOn(ldapAuth, 'authenticateViaLdap').mockResolvedValue({ user: ldapUser });

    const { token, authMethod } = await login('erin', 'directory-password');

    expect(authMethod).toBe('ldap');
    expect(verifyJWT(token)?.authTime).toBe(T0_SECONDS);
  });
});
