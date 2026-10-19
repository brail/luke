/**
 * An SSE stream ends with the session it was opened from.
 *
 * The ticket carries that session (`userId`, `tokenVersion`, `authTime`), and the route checks it when
 * the stream opens and on every heartbeat: a logout, any other revocation or a deactivation ends the
 * stream at the next check, and the 12 h limit ends it on time through a timer of its own. The check
 * runs in a timer, outside any request: a failure there is logged and ends the stream instead of
 * becoming an unhandled rejection, and the stream is unsubscribed before it is ended, so a push
 * landing in between writes nothing.
 *
 * Real HTTP on `127.0.0.1` (a stream cannot go through `inject`), with a 100 ms heartbeat.
 */
import { get, ServerResponse, type IncomingMessage } from 'http';

import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { SESSION_ABSOLUTE_LIFETIME_SECONDS } from '@luke/core';
import type { PrismaClient } from '@luke/db';

import { sseStore } from '../src/lib/sseStore';
import { invalidateTokenVersionCache } from '../src/lib/tokenVersionCache';
import { isSseSessionLive, registerSseRoute } from '../src/routes/sse';

import { createCallerWithSession, createTestUser, setupTestDb } from './helpers';

const HEARTBEAT_MS = 100;
/** One heartbeat interval plus two check durations, with room for a loaded machine. */
const END_BOUND_MS = 2 * HEARTBEAT_MS + 1500;

let prisma: PrismaClient;
let app: FastifyInstance;
let url: string;
let logLines: string[] = [];
const openStreams: IncomingMessage[] = [];

beforeAll(async () => {
  prisma = await setupTestDb();
  app = Fastify({ logger: { level: 'warn', stream: { write: (line: string) => void logLines.push(line) } } });
  await registerSseRoute(app, [], { prisma, heartbeatMs: HEARTBEAT_MS });
  url = await app.listen({ port: 0, host: '127.0.0.1' });
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  prisma = await setupTestDb();
  logLines = [];
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const stream of openStreams.splice(0)) stream.destroy();
});

const nowSeconds = () => Math.floor(Date.now() / 1000);
const tick = () => new Promise(resolve => setImmediate(resolve));
const loggedStreamErrors = () => logLines.filter(line => line.includes('SSE stream error'));

function within<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`not within ${ms} ms`)), ms)),
  ]);
}

/** Opens the stream for `ticket` and collects the event types it receives. */
async function openStream(ticket: string, base = url) {
  const res = await new Promise<IncomingMessage>((resolve, reject) =>
    get(`${base}/api/sse?ticket=${ticket}`, resolve).on('error', reject)
  );
  openStreams.push(res);
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
  const ended = new Promise<void>(resolve => {
    res.on('end', resolve);
    res.on('close', resolve);
  });
  return { res, status: res.statusCode, events, ended };
}

/** A signed-in user with an open, live stream that has already beaten once. */
async function liveStream() {
  const { user, session } = await createTestUser('editor');
  const { ticket } = await createCallerWithSession(session).notifications.getSseTicket();
  const stream = await openStream(ticket);
  expect(stream.status).toBe(200);
  await vi.waitFor(() => expect(stream.events).toContain('heartbeat'), { timeout: END_BOUND_MS });
  return { user, session, stream };
}

/**
 * Holds the next read of the user row (`verifyTokenVersion`'s, after the cache entry is dropped)
 * before it runs, or with `after`, once it has run; every later read passes.
 */
function holdNextUserRead(userId: string, { after = false } = {}) {
  invalidateTokenVersionCache(userId);
  let reached!: () => void;
  const reachedRead = new Promise<void>(resolve => (reached = resolve));
  let release!: () => void;
  const released = new Promise<void>(resolve => (release = resolve));
  const findUnique = prisma.user.findUnique.bind(prisma.user);
  let held = false;
  vi.spyOn(prisma.user, 'findUnique').mockImplementation(
    // The spy keeps the delegate's own signature; only the first call is held.
    (async (args: unknown) => {
      if (held) return findUnique(args as never);
      held = true;
      const row = after ? await findUnique(args as never) : undefined;
      reached();
      await released;
      return after ? row : findUnique(args as never);
    }) as never
  );
  return { reachedRead, release };
}

describe('isSseSessionLive', () => {
  it('accepts a live session and refuses a revoked one, an inactive user and one past 12 h', async () => {
    const [{ user }, { user: inactive }] = await Promise.all([createTestUser('editor'), createTestUser('viewer')]);
    const live = { userId: user.id, tokenVersion: 0, authTime: nowSeconds() };

    await expect(isSseSessionLive(live, prisma)).resolves.toBe(true);
    await expect(
      isSseSessionLive({ ...live, authTime: nowSeconds() - SESSION_ABSOLUTE_LIFETIME_SECONDS }, prisma)
    ).resolves.toBe(false);

    await prisma.user.update({ where: { id: user.id }, data: { tokenVersion: { increment: 1 } } });
    invalidateTokenVersionCache(user.id);
    await expect(isSseSessionLive(live, prisma)).resolves.toBe(false);

    await prisma.user.update({ where: { id: inactive.id }, data: { isActive: false } });
    invalidateTokenVersionCache(inactive.id);
    await expect(isSseSessionLive({ ...live, userId: inactive.id }, prisma)).resolves.toBe(false);
  });
});

describe('notifications.getSseTicket', () => {
  it('refuses a session without authTime: the ticket has no login time to carry', async () => {
    const { session } = await createTestUser('editor');

    await expect(
      createCallerWithSession({ user: { ...session.user, authTime: undefined } }).notifications.getSseTicket()
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});

describe('the SSE stream', () => {
  it('ends after auth.logout within one heartbeat and two checks', async () => {
    const { user, session, stream } = await liveStream();

    await createCallerWithSession(session).auth.logout();

    await within(stream.ended, END_BOUND_MS);
    expect(sseStore.connectedUserIds()).not.toContain(user.id);
  });

  it('answers 401 at open for a session revoked after its ticket was issued, and opens no stream', async () => {
    const { user, session } = await createTestUser('editor');
    const { ticket } = await createCallerWithSession(session).notifications.getSseTicket();
    await createCallerWithSession(session).auth.logout();

    const stream = await openStream(ticket);

    expect(stream.status).toBe(401);
    expect(stream.events).toEqual([]);
    expect(sseStore.connectedUserIds()).not.toContain(user.id);
  });

  it('opens nothing for a client that left during the check at open', async () => {
    const { user, session } = await createTestUser('editor');
    const { ticket } = await createCallerWithSession(session).notifications.getSseTicket();
    const { reachedRead, release } = holdNextUserRead(user.id);
    const request = get(`${url}/api/sse?ticket=${ticket}`).on('error', () => undefined);
    await reachedRead;

    request.destroy();
    // Long enough for the server to see the socket close while the check is held; were it shorter,
    // the route's own `close` listener would clean up and the test would pass for the wrong reason.
    await new Promise(resolve => setTimeout(resolve, 200));
    release();
    await new Promise(resolve => setTimeout(resolve, 3 * HEARTBEAT_MS));

    expect(sseStore.connectedUserIds()).not.toContain(user.id);
  });

  it('unsubscribes before ending: a push right after the end writes nothing and raises no stream error', async () => {
    const { user, session, stream } = await liveStream();
    const end = ServerResponse.prototype.end;
    vi.spyOn(ServerResponse.prototype, 'end').mockImplementation(
      // The spy keeps `end`'s overloads. A push from another request can land between the route's
      // `end()` and the response's `close`; this one lands right after `end()`.
      function (this: ServerResponse, ...args: unknown[]) {
        const result = end.apply(this, args as never);
        sseStore.pushToUser(user.id, { type: 'heartbeat' });
        return result;
      } as never
    );

    await createCallerWithSession(session).auth.logout();
    await within(stream.ended, END_BOUND_MS);
    await tick();

    expect(loggedStreamErrors()).toEqual([]);
  });

  it('ends the stream when a heartbeat check fails, with no unhandled rejection', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const { user, stream } = await liveStream();
      invalidateTokenVersionCache(user.id);
      vi.spyOn(prisma.user, 'findUnique').mockRejectedValue(new Error('database unavailable'));

      await within(stream.ended, END_BOUND_MS);
      await tick();

      expect(logLines.some(line => line.includes('SSE session check failed'))).toBe(true);
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('writes nothing when a check resumes after the stream closed', async () => {
    const { user, stream } = await liveStream();
    const { reachedRead, release } = holdNextUserRead(user.id);
    await reachedRead;
    const write = vi.spyOn(ServerResponse.prototype, 'write');

    stream.res.destroy();
    await vi.waitFor(() => expect(sseStore.connectedUserIds()).not.toContain(user.id));
    release();
    await new Promise(resolve => setTimeout(resolve, 3 * HEARTBEAT_MS));

    expect(write).not.toHaveBeenCalled();
    expect(loggedStreamErrors()).toEqual([]);
  });

  it('keeps the stream on a check that read before a revocation, and ends it on the next one', async () => {
    const { user, session, stream } = await liveStream();
    const { reachedRead, release } = holdNextUserRead(user.id, { after: true });
    await reachedRead;

    await createCallerWithSession(session).auth.logout();
    const beats = stream.events.length;
    release();

    await vi.waitFor(() => expect(stream.events.length).toBeGreaterThan(beats), { timeout: END_BOUND_MS });
    await within(stream.ended, END_BOUND_MS);
  });

  it('ends at 12 h from the login on its own timer, with no database call', async () => {
    // A heartbeat that never comes within the test: only the lifetime timer can end the stream.
    const slow = Fastify({ logger: false });
    await registerSseRoute(slow, [], { prisma, heartbeatMs: 60_000 });
    const slowUrl = await slow.listen({ port: 0, host: '127.0.0.1' });
    try {
      const { user } = await createTestUser('editor');
      // Three seconds of lifetime left: enough for the check at open, short enough to wait for.
      const authTime = nowSeconds() - SESSION_ABSOLUTE_LIFETIME_SECONDS + 3;
      sseStore.createTicket('sse-lifetime-ticket', { userId: user.id, tokenVersion: 0, authTime });

      const stream = await openStream('sse-lifetime-ticket', slowUrl);
      expect(stream.status).toBe(200);
      const findUnique = vi.spyOn(prisma.user, 'findUnique');

      await within(stream.ended, 5000);
      expect(findUnique).not.toHaveBeenCalled();
    } finally {
      for (const stream of openStreams.splice(0)) stream.destroy();
      await slow.close();
    }
  });
});
