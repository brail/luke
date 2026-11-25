/**
 * The SSE store keeps going past a stream that fails: a revocation ends every stream of the user
 * even when ending one of them throws, and a push still reaches the others when a write throws
 * (`sessionRevocation.ts` relies on both, ADR-052).
 */
import { describe, expect, it, vi } from 'vitest';

import { sseStore } from '../src/lib/sseStore';

import type { FastifyReply } from 'fastify';

/** A stand-in for a stream's reply; only `raw.write` is used by a push. */
const reply = (write: () => void = () => {}) => ({ raw: { write } }) as unknown as FastifyReply; // Only the field the store touches.

describe('sseStore', () => {
  it("ends every stream of the user even when one end throws, and no other user's", () => {
    const broken = reply();
    const healthy = reply();
    const bystander = reply();
    const endHealthy = vi.fn(() => sseStore.unsubscribe('u', healthy));
    const endBystander = vi.fn();
    sseStore.subscribe('u', broken, () => {
      throw new Error('already closing');
    });
    sseStore.subscribe('u', healthy, endHealthy);
    sseStore.subscribe('other', bystander, endBystander);

    sseStore.endUser('u');

    expect(endHealthy).toHaveBeenCalledOnce();
    expect(endBystander).not.toHaveBeenCalled();
    sseStore.unsubscribe('u', broken);
    sseStore.unsubscribe('other', bystander);
  });

  it('pushes to every stream of the user even when one write throws', () => {
    const write = vi.fn();
    const broken = reply(() => {
      throw new Error('write after end');
    });
    const healthy = reply(write);
    sseStore.subscribe('u', broken, () => {});
    sseStore.subscribe('u', healthy, () => {});

    sseStore.pushToUser('u', { type: 'session-revoked' });

    expect(write).toHaveBeenCalledWith('data: {"type":"session-revoked"}\n\n');
    sseStore.unsubscribe('u', broken);
    sseStore.unsubscribe('u', healthy);
  });
});
