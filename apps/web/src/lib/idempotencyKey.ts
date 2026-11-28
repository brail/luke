import { hashKey } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import { uuidV4 } from './uuid';

/**
 * The key of each payload an action sent, by the payload object itself. tRPC's React hooks take
 * request context only per `useMutation`, never per call, while the payload reaches the link as
 * the same object (`op.input`): tying the key to it keeps one key per action, and a call on the
 * same mutation with another payload (a task ticked while one is being created) carries none.
 */
const keyByPayload = new WeakMap<object, string>();

/** Gives `payload` an `Idempotency-Key` (a fresh one by default), sent with it by `browserLinks`. */
export function attachIdempotencyKey(payload: object, key: string = uuidV4()): void {
  keyByPayload.set(payload, key);
}

/** The `Idempotency-Key` an action attached to this tRPC input, if any (read by the tRPC link). */
export function idempotencyKeyOf(input: unknown): string | undefined {
  return typeof input === 'object' && input !== null ? keyByPayload.get(input) : undefined;
}

/** Codes whose request may have run, or surely did not: neither is the procedure's own refusal. */
const OUTCOME_UNKNOWN_CODES = new Set(['SERVICE_UNAVAILABLE', 'TOO_MANY_REQUESTS']);

/**
 * Whether a failed call was refused by the procedure itself, so it stored nothing under its key:
 * an answer with a tRPC code (no answer at all has none) that is not a gateway's or the limiter's
 * (`trpcFetch` gives them `SERVICE_UNAVAILABLE` and `TOO_MANY_REQUESTS`), nor one of the
 * idempotency layer's refusals (`data.idempotency`, apps/api `IdempotencyRefusedError`).
 */
function refusedByProcedure(error: unknown): boolean {
  // A rejected `mutateAsync` gives `unknown`; only the tRPC error's `data` is read, defensively.
  const data = (error as { data?: { code?: unknown; idempotency?: unknown } } | null)?.data;
  return typeof data?.code === 'string' && !OUTCOME_UNKNOWN_CODES.has(data.code) && data.idempotency === undefined;
}

/**
 * One idempotency key per user action, for a create that must not run twice (#248; the API's
 * `withIdempotency`):
 * - `submit(payload)` starts an attempt: a fresh key, kept with the payload;
 * - a submit of an equal payload while the attempt is unconfirmed (it failed, or its answer was
 *   lost) resends the kept payload with its key, so the server replays instead of creating again;
 * - another payload is a new action, with a new key;
 * - a success ends the attempt, and so does a refusal by the procedure itself, which stored nothing
 *   (the next submit is built afresh, e.g. from a list that has refreshed since); an unknown outcome
 *   (no answer, a gateway's or the limiter's) and the idempotency layer's own refusals keep it;
 * - every change of `open` ends it too: a dialog that stays mounted passes its open state, so each
 *   opening is a new action (one whose body mounts only while open ends it by unmounting).
 *
 * `submitBuilt(entered, build)` compares what the user entered instead, and builds the payload once
 * per attempt: for a value read from a query, which must not change a retry (ApplyTemplate's
 * `force`). `submitAsync` returns the outcome, for a caller that awaits; `submit` leaves it to the
 * mutation's own callbacks. All go through `mutateAsync`, whose promise settles for every call:
 * `mutate`'s per-call callbacks run only for the latest call, so a success could go unseen.
 * `resubmit(refused, change)` sends a refused payload again, changed, under the same key and as the
 * same attempt: for a request the server refused until the user confirmed (a refusal stores
 * nothing under the key), so a lost answer to the confirmed one still replays.
 */
export function useIdempotentAction<TPayload extends object, TData>(
  mutation: { mutateAsync: (payload: TPayload) => Promise<TData> },
  { open }: { open?: boolean } = {}
) {
  const attempt = useRef<{ entered: string; payload: TPayload } | null>(null);

  useEffect(() => {
    attempt.current = null;
  }, [open]);

  /** The payload to send: the current attempt's when `entered` equals its data, else a new one. */
  const payloadFor = (entered: unknown, build: () => TPayload): TPayload => {
    const hash = hashKey([entered]);
    let current = attempt.current;
    if (current?.entered !== hash) {
      const payload = build();
      attachIdempotencyKey(payload);
      current = attempt.current = { entered: hash, payload };
    }
    return current.payload;
  };

  /** Sends `payload`; a success or a refusal ends its attempt, unless a newer one replaced it. */
  const send = async (payload: TPayload): Promise<TData> => {
    const end = () => {
      if (attempt.current?.payload === payload) attempt.current = null;
    };
    try {
      const data = await mutation.mutateAsync(payload);
      end();
      return data;
    } catch (error) {
      if (refusedByProcedure(error)) end();
      throw error;
    }
  };

  // A failure reaches the mutation's own `onError`; nothing else is left to do with it here.
  const fire = (payload: TPayload): void => void send(payload).catch(() => undefined);

  return {
    submit: (payload: TPayload): void => fire(payloadFor(payload, () => payload)),
    submitAsync: (payload: TPayload): Promise<TData> => send(payloadFor(payload, () => payload)),
    submitBuilt: <TEntered,>(entered: TEntered, build: (entered: TEntered) => TPayload): void =>
      fire(payloadFor(entered, () => build(entered))),
    resubmit: (refused: TPayload, change: (payload: TPayload) => TPayload): void => {
      const payload = change(refused);
      attachIdempotencyKey(payload, idempotencyKeyOf(refused));
      attempt.current = { entered: hashKey([refused]), payload };
      fire(payload);
    },
  };
}
