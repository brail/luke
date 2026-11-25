/**
 * A revocation takes effect at once (ADR-052): every path that ends a user's sessions goes through
 * `revokingTransaction`, which after the commit tells the user's open streams (`session-revoked`)
 * and ends them, so a tab signs out within a second instead of at its next check. A transaction
 * that rolls back publishes nothing. A bearer that no longer authenticates answers
 * `SessionEndedError` (`data.sessionEnded`); a request with no bearer, or a wrong current password,
 * does not.
 *
 * Real HTTP on `127.0.0.1` (a stream cannot go through `inject`), with a heartbeat far longer than
 * the test: a stream that ends here was ended by the push, not by its own check.
 */
import { get, type IncomingMessage } from 'http';

import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { HARD_DELETE_CONFIRM_PHRASE } from '@luke/core';
import type { PrismaClient } from '@luke/db';

import { SessionEndedError } from '../src/lib/error';
import { forceLogoutNonAdmins } from '../src/lib/maintenanceMode';
import { revokingTransaction } from '../src/lib/sessionRevocation';
import { appRouter } from '../src/routers/index';
import { registerSseRoute } from '../src/routes/sse';

import {
  createCallerWithSession,
  createTestContext,
  createTestUser,
  setupTestDb,
} from './helpers';

/** Well inside a heartbeat: the push ends the stream as soon as the revocation commits. */
const PUSH_BOUND_MS = 1000;

let prisma: PrismaClient;
let app: FastifyInstance;
let url: string;
const openStreams: IncomingMessage[] = [];

beforeAll(async () => {
  prisma = await setupTestDb();
  app = Fastify({ logger: false });
  await registerSseRoute(app, [], { prisma, heartbeatMs: 60_000 });
  url = await app.listen({ port: 0, host: '127.0.0.1' });
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  prisma = await setupTestDb();
});

afterEach(() => {
  for (const stream of openStreams.splice(0)) stream.destroy();
});

function within<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`not within ${ms} ms`)), ms)),
  ]);
}

/** A signed-in user of `role` with an open stream; `events` collects the event types it receives. */
async function userWithStream(role: 'admin' | 'editor' | 'viewer' = 'editor') {
  const { user, session } = await createTestUser(role);
  const { ticket } = await createCallerWithSession(session).notifications.getSseTicket();
  const res = await new Promise<IncomingMessage>((resolve, reject) =>
    get(`${url}/api/sse?ticket=${ticket}`, resolve).on('error', reject)
  );
  openStreams.push(res);
  expect(res.statusCode).toBe(200);
  const events: string[] = [];
  let buffer = '';
  res.setEncoding('utf8');
  res.on('data', (chunk: string) => {
    buffer += chunk;
    for (let end = buffer.indexOf('\n\n'); end !== -1; end = buffer.indexOf('\n\n')) {
      const frame = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      if (frame.startsWith('data: ')) events.push((JSON.parse(frame.slice(6)) as { type: string }).type);
    }
  });
  let isEnded = false;
  const ended = new Promise<void>(resolve => {
    const done = () => {
      isEnded = true;
      resolve();
    };
    res.on('end', done);
    res.on('close', done);
  });
  await expect.poll(() => events).toContain('connected');
  return { user, session, events, ended, isEnded: () => isEnded };
}

/** Time for a push or an end that would wrongly reach another stream to arrive. */
const settle = () => new Promise(resolve => setTimeout(resolve, 200));

/** The error a call rejects with. */
async function rejection(call: Promise<unknown>): Promise<unknown> {
  return call.then(
    () => expect.fail('the call succeeded'),
    (error: unknown) => error
  );
}

describe('a revocation', () => {
  it.each([
    ['a sign-out', 'auth.logout'],
    ['revoking all of one’s own sessions', 'me.revokeAllSessions'],
  ] as const)('by %s tells the open tabs and ends their streams', async (_name, path) => {
    const target = await userWithStream();
    const caller = createCallerWithSession(target.session);

    await (path === 'auth.logout' ? caller.auth.logout() : caller.me.revokeAllSessions());

    await within(target.ended, PUSH_BOUND_MS);
    expect(target.events).toEqual(['connected', 'session-revoked']);
    // The bearer the tab still holds is refused as an ended session.
    expect(await rejection(caller.me.get())).toBeInstanceOf(SessionEndedError);
  });

  it.each([
    ['revoking their sessions', (id: string) => ({ revoke: id })],
    ['deactivating them', (id: string) => ({ deactivate: id })],
    ['deleting them', (id: string) => ({ remove: id })],
  ])('of another user by an administrator, %s, ends that user’s streams', async (_name, action) => {
    const target = await userWithStream();
    const bystander = await userWithStream();
    const { session: adminSession } = await createTestUser('admin');
    const admin = createCallerWithSession(adminSession);
    const what = action(target.user.id);

    if ('revoke' in what) await admin.users.revokeUserSessions({ id: what.revoke });
    if ('deactivate' in what) await admin.users.softDelete({ id: what.deactivate });
    if ('remove' in what) await admin.users.hardDelete({ id: what.remove, confirmPhrase: HARD_DELETE_CONFIRM_PHRASE });

    await within(target.ended, PUSH_BOUND_MS);
    expect(target.events).toContain('session-revoked');
    await settle();
    expect(bystander.isEnded()).toBe(false);
    expect(bystander.events).not.toContain('session-revoked');
  });

  it('in bulk, at maintenance, ends the streams of whoever cannot bypass it and no others', async () => {
    const editor = await userWithStream('editor');
    const admin = await userWithStream('admin');

    await forceLogoutNonAdmins(prisma);

    await within(editor.ended, PUSH_BOUND_MS);
    expect(editor.events).toContain('session-revoked');
    await settle();
    expect(admin.isEnded()).toBe(false);
    expect(admin.events).not.toContain('session-revoked');
  });

  it('that rolls back publishes nothing, and the session stays valid', async () => {
    const target = await userWithStream();

    await expect(
      revokingTransaction(prisma, async (tx, revoke) => {
        await tx.user.update({ where: { id: target.user.id }, data: { tokenVersion: revoke.user(target.user.id) } });
        throw new Error('refused after the write');
      })
    ).rejects.toThrow('refused after the write');

    await settle();
    expect(target.isEnded()).toBe(false);
    expect(target.events).toEqual(['connected']);
    await expect(createCallerWithSession(target.session).me.get()).resolves.toBeDefined();
  });

  it('cannot be recorded after its transaction ended: nobody would be told', async () => {
    const { user } = await createTestUser('editor');
    let kept: Parameters<Parameters<typeof revokingTransaction>[1]>[1] | undefined;

    await revokingTransaction(prisma, async (_tx, revoke) => {
      kept = revoke;
    });

    expect(() => kept?.user(user.id)).toThrow('after its transaction ended');
    expect(() => kept?.ended(user.id)).toThrow('after its transaction ended');
  });

  it('is not what an update that changes nothing about access does', async () => {
    const target = await userWithStream();
    const { session: adminSession } = await createTestUser('admin');

    await createCallerWithSession(adminSession).users.update({ id: target.user.id, firstName: 'Renamed' });

    await settle();
    expect(target.isEnded()).toBe(false);
    expect(target.events).toEqual(['connected']);
  });
});

describe('an ended session', () => {
  it('is how a bearer that no longer authenticates is refused', async () => {
    const ctx = createTestContext(null);
    ctx.req.headers.authorization = 'Bearer no-longer-valid';

    expect(await rejection(appRouter.createCaller(ctx).me.get())).toBeInstanceOf(SessionEndedError);
  });

  it('is not how a request with no bearer is refused: a page still loading its session sends none', async () => {
    const error = await rejection(appRouter.createCaller(createTestContext(null)).me.get());

    expect(error).toMatchObject({ code: 'UNAUTHORIZED' });
    expect(error).not.toBeInstanceOf(SessionEndedError);
  });

  it('is not how a wrong current password is refused', async () => {
    const { session } = await createTestUser('editor');

    const error = await rejection(
      createCallerWithSession(session).me.changePassword({
        currentPassword: 'not-the-password',
        newPassword: 'An0ther-Passw0rd!',
        confirmNewPassword: 'An0ther-Passw0rd!',
      })
    );

    expect(error).not.toBeInstanceOf(SessionEndedError);
  });
});
