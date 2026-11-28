import { expect, test, vi } from 'vitest';
import { renderHook } from 'vitest-browser-react';

import { idempotencyKeyOf, useIdempotentAction } from '../idempotencyKey';

/**
 * One key per user action (#248): a retry of an unconfirmed attempt resends the same payload with
 * the same key, so the API replays it; a success, a refusal by the procedure, another payload or a
 * change of `open` starts a new one.
 */

/** How a call can fail, as `mutateAsync` rejects. */
const LOST = new Error('Failed to fetch'); // no answer: a TRPCClientError without `data`
const IN_FLIGHT = { data: { code: 'CONFLICT', idempotency: 'inFlight' } };
const REFUSED = { data: { code: 'CONFLICT' } }; // the procedure's own refusal

type Payload = { label: string; force?: boolean };

/** A mutation stand-in: records each payload; each call stays unanswered until the test settles it. */
function fakeMutation() {
  const sent: Payload[] = [];
  const answers: Array<{ succeed: () => void; fail: (error: unknown) => void }> = [];
  return {
    sent,
    succeed: async (call: number) => {
      answers[call]?.succeed();
      await Promise.resolve();
    },
    fail: async (call: number, error: unknown = LOST) => {
      answers[call]?.fail(error);
      await Promise.resolve();
    },
    mutateAsync: vi.fn(
      (payload: Payload) =>
        new Promise<Payload>((resolve, reject) => {
          sent.push(payload);
          answers.push({ succeed: () => resolve(payload), fail: reject });
        })
    ),
  };
}

async function setup(open?: boolean) {
  const mutation = fakeMutation();
  const hook = await renderHook((props?: { open?: boolean }) => useIdempotentAction(mutation, { open: props?.open }), {
    initialProps: { open },
  });
  return { mutation, action: () => hook.result.current, rerender: hook.rerender };
}

const keyOf = (payload: Payload | undefined) => idempotencyKeyOf(payload);

test('a retry of an equal payload resends the first one, with its key', async () => {
  const { mutation, action } = await setup();

  action().submit({ label: 'Task' }); // no answer: failed, or lost
  action().submit({ label: 'Task' });

  expect(mutation.sent[1]).toBe(mutation.sent[0]);
  expect(keyOf(mutation.sent[0])).toBeDefined();
});

test('a success ends the attempt: the same payload again is a new action with a new key', async () => {
  const { mutation, action } = await setup();

  action().submit({ label: 'Task' });
  await mutation.succeed(0);
  action().submit({ label: 'Task' });

  expect(mutation.sent[1]).not.toBe(mutation.sent[0]);
  expect(keyOf(mutation.sent[1])).not.toBe(keyOf(mutation.sent[0]));
});

test('another payload is a new action, and so is the same one after the dialog reopens', async () => {
  const { mutation, action, rerender } = await setup(true);

  action().submit({ label: 'Task' });
  action().submit({ label: 'Other task' });
  await rerender({ open: false });
  await rerender({ open: true });
  action().submit({ label: 'Other task' });

  expect(new Set(mutation.sent.map(keyOf)).size).toBe(3);
});

test('submitBuilt freezes a value the build reads from a query', async () => {
  const { mutation, action } = await setup();
  let hasEvents = false;
  const withForce = (label: string): Payload => ({ label, force: hasEvents });

  action().submitBuilt('Template', withForce);
  hasEvents = true; // the list refreshed after the lost answer: the group now has its events
  action().submitBuilt('Template', withForce);

  expect(mutation.sent[1]).toBe(mutation.sent[0]);
  expect(mutation.sent[1]).toEqual({ label: 'Template', force: false });
});

test('a call on the same mutation with its own payload carries no key', async () => {
  const { mutation, action } = await setup();

  action().submit({ label: 'Task' });
  const tick: Payload = { label: 'Task' };
  void mutation.mutateAsync(tick);

  expect(keyOf(mutation.sent[0])).toBeDefined();
  expect(keyOf(tick)).toBeUndefined();
});

test('a success ends the attempt even when a second call went out meanwhile', async () => {
  const { mutation, action } = await setup();

  action().submit({ label: 'Task' });
  action().submit({ label: 'Task' }); // a double submit: the API answers it "already in progress"
  await mutation.fail(1, IN_FLIGHT);
  await mutation.succeed(0);
  action().submit({ label: 'Task' });

  expect(keyOf(mutation.sent[2])).not.toBe(keyOf(mutation.sent[0]));
});

test('submitAsync keeps the attempt after a failure and ends it on success', async () => {
  const { mutation, action } = await setup();

  const failed = action().submitAsync({ label: 'Vendor' });
  await mutation.fail(0);
  await expect(failed).rejects.toBe(LOST);
  const retried = action().submitAsync({ label: 'Vendor' });
  await mutation.succeed(1);
  await retried;
  void action().submitAsync({ label: 'Vendor' });

  expect(mutation.sent[1]).toBe(mutation.sent[0]);
  expect(keyOf(mutation.sent[2])).not.toBe(keyOf(mutation.sent[0]));
});

test('resubmit sends the confirmed request under the same key, and a retry resends it', async () => {
  const { mutation, action } = await setup();

  action().submit({ label: 'Event' });
  await mutation.fail(0, REFUSED); // refused until the user confirms
  action().resubmit(mutation.sent[0], sent => ({ ...sent, force: true }));
  action().submit({ label: 'Event' }); // its answer was lost: Save again

  expect(mutation.sent[1]).toEqual({ label: 'Event', force: true });
  expect(keyOf(mutation.sent[1])).toBe(keyOf(mutation.sent[0]));
  expect(mutation.sent[2]).toBe(mutation.sent[1]);
});

test("a refusal by the procedure ends the attempt: the next submit is built afresh", async () => {
  const { mutation, action } = await setup();
  let hasEvents = false;
  const withForce = (label: string): Payload => ({ label, force: hasEvents });

  action().submitBuilt('Template', withForce);
  await mutation.fail(0, REFUSED); // "the group already has events": nothing stored
  hasEvents = true;
  action().submitBuilt('Template', withForce);

  expect(mutation.sent[1]).toEqual({ label: 'Template', force: true });
  expect(keyOf(mutation.sent[1])).not.toBe(keyOf(mutation.sent[0]));
});

test.each([
  ['no answer', LOST],
  ['a gateway', { data: { code: 'SERVICE_UNAVAILABLE' } }],
  ['the limiter', { data: { code: 'TOO_MANY_REQUESTS' } }],
  ['the idempotency layer', IN_FLIGHT],
])('an unknown outcome (%s) keeps the attempt and its key', async (_name, error) => {
  const { mutation, action } = await setup();

  action().submit({ label: 'Task' });
  await mutation.fail(0, error);
  action().submit({ label: 'Task' });

  expect(mutation.sent[1]).toBe(mutation.sent[0]);
});
