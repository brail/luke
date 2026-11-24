import { describe, expect, it } from 'vitest';

import { sendsUnbatched, trpcLaneOf } from '../url.js';

describe('trpcLaneOf', () => {
  it.each([
    ['/trpc/me.get', 'essential'],
    ['/trpc/auth.refreshToken', 'essential'],
    ['/trpc/me.get,auth.logout', 'essential'],
    ['/trpc/users.heartbeat', 'background'],
    ['/trpc/users.heartbeat,notifications.getSseTicket', 'background'],
    ['/trpc/notifications.list', 'normal'],
  ] as const)('%s is %s', (path, lane) => {
    expect(trpcLaneOf(path)).toBe(lane);
  });

  it.each([
    ['a batch mixing lanes', '/trpc/me.get,users.heartbeat'],
    ['a batch with another procedure', '/trpc/me.get,notifications.list'],
    ['an empty procedure list', '/trpc/'],
    ['a trailing separator', '/trpc/me.get,'],
    ['an encoded separator', '/trpc/me.get%2Cusers.heartbeat'],
    ['a near-miss name', '/trpc/me.getx'],
    ['a path outside tRPC', '/api/sse'],
    ['a prefix without the slash', '/trpcme.get'],
  ])('%s is normal', (_case, path) => {
    expect(trpcLaneOf(path)).toBe('normal');
  });
});

describe('sendsUnbatched', () => {
  it('sends a listed procedure alone and batches the rest', () => {
    expect([sendsUnbatched('me.get'), sendsUnbatched('users.heartbeat'), sendsUnbatched('notifications.list')]).toEqual([true, true, false]);
  });
});
