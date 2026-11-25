import { focusManager } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';


import { SessionVerification } from '../../components/SessionVerification';
import { TRPCProvider } from '../../lib/trpc';
import { SseProvider, useSseConnected, useSseFallbackPoll, useSseMessage } from '../SseProvider';

/**
 * The shared SSE stream and the session (ADR-052): a pushed `session-revoked` signs the tab out at
 * once; while the stream is open, `useSseConnected` lets polling stop, and a dropped or silent stream
 * turns it back on; a ticket refused because the session ended is not asked for again, and one
 * refused with a wait is asked for after it.
 */

const h = vi.hoisted(() => ({ endSession: vi.fn() }));
vi.mock('next-auth/react', () => ({
  useSession: () => ({ status: 'authenticated', data: { accessToken: 'token' } }),
  signOut: () => {},
}));
// Observed directly: its once-per-page flag would carry from one test to the next
// (`sessionEnd.browser.test.tsx` proves the flag).
vi.mock('../../lib/sessionEnd', async importOriginal => ({
  ...(await importOriginal<typeof import('../../lib/sessionEnd')>()),
  endSession: h.endSession,
}));

/** The `EventSource`s the provider opened, driven by hand. */
const sources: FakeEventSource[] = [];
class FakeEventSource {
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly url: string) {
    sources.push(this);
  }
  close() {}
  emit(data: object) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }
}

const network = vi.fn<typeof fetch>();
const ticketCalls = () => network.mock.calls.filter(([input]) => String(input).includes('getSseTicket')).length;
const ticketRefused = (data: object) =>
  Response.json({ error: { message: 'refused', code: -32001, data: { httpStatus: 401, ...data } } }, { status: 401 });

/** The message types a consumer received. */
const received: string[] = [];

function Connected() {
  useSseMessage<{ type: string }>(data => received.push(data.type));
  const poll = useSseFallbackPoll();
  return (
    <>
      <p>{useSseConnected() ? 'stream open' : 'stream down'}</p>
      <p>{poll === false ? 'no polling' : `polling every ${poll} ms`}</p>
    </>
  );
}

const mount = () =>
  render(
    <TRPCProvider>
      <SseProvider>
        <Connected />
        <SessionVerification />
      </SseProvider>
    </TRPCProvider>
  );

beforeEach(() => {
  vi.stubGlobal('fetch', network);
  vi.stubGlobal('EventSource', FakeEventSource);
  // The lowest jitter: a reconnect still waits half its 5 s backoff.
  vi.spyOn(Math, 'random').mockReturnValue(0);
});

afterEach(() => {
  h.endSession.mockReset();
  network.mockReset();
  sources.splice(0);
  received.splice(0);
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test('the stream reports itself open, and a pushed session-revoked signs out', async () => {
  network.mockImplementation(async () => Response.json({ result: { data: { ticket: 't1' } } }));
  const screen = await mount();
  await expect.poll(() => sources.length).toBe(1);
  await expect.element(screen.getByText('stream down')).toBeInTheDocument();
  await expect.element(screen.getByText('polling every 120000 ms')).toBeInTheDocument();

  sources[0]?.onopen?.();
  await expect.element(screen.getByText('stream open')).toBeInTheDocument();
  await expect.element(screen.getByText('no polling')).toBeInTheDocument();

  sources[0]?.emit({ type: 'session-revoked' });
  await expect.poll(() => h.endSession.mock.calls.length).toBe(1);
});

test('a ticket refused because the session ended signs out and is not asked for again', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  network.mockImplementation(async () => ticketRefused({ code: 'UNAUTHORIZED', sessionEnded: true }));
  await mount();
  await vi.waitFor(() => expect(ticketCalls()).toBe(1));
  // A mutation answering `sessionEnded`: the global `MutationCache` handler signs out.
  await vi.waitFor(() => expect(h.endSession).toHaveBeenCalledOnce());

  await vi.advanceTimersByTimeAsync(120_000);
  expect(ticketCalls()).toBe(1);
});

test('a ticket refused with a wait is asked for again only after it', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  network.mockImplementation(async () =>
    ticketRefused({ code: 'TOO_MANY_REQUESTS', httpStatus: 429, retryAfterSeconds: 30 })
  );
  await mount();
  await vi.waitFor(() => expect(ticketCalls()).toBe(1));

  await vi.advanceTimersByTimeAsync(29_999);
  expect(ticketCalls()).toBe(1);
  await vi.advanceTimersByTimeAsync(1);
  await vi.waitFor(() => expect(ticketCalls()).toBe(2));
});

test('a dropped stream reports itself down, and a silent one is reopened', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  network.mockImplementation(async () => Response.json({ result: { data: { ticket: 't' } } }));
  const screen = await mount();
  await vi.waitFor(() => expect(sources).toHaveLength(1));

  sources[0]?.onopen?.();
  await expect.element(screen.getByText('stream open')).toBeInTheDocument();
  sources[0]?.onerror?.();
  await expect.element(screen.getByText('stream down')).toBeInTheDocument();

  // Reopened after the backoff, then silent: no beat for 75 s counts as dead.
  await vi.advanceTimersByTimeAsync(2_500);
  await vi.waitFor(() => expect(sources).toHaveLength(2));
  sources[1]?.onopen?.();
  await expect.element(screen.getByText('stream open')).toBeInTheDocument();
  await vi.advanceTimersByTimeAsync(74_999);
  expect(ticketCalls()).toBe(2);
  await vi.advanceTimersByTimeAsync(1);
  await expect.element(screen.getByText('stream down')).toBeInTheDocument();
});

test('an open stream needs no session check when the tab comes back', async () => {
  network.mockImplementation(async () => Response.json({ result: { data: { ticket: 't' } } }));
  const screen = await mount();
  await expect.poll(() => sources.length).toBe(1);
  sources[0]?.onopen?.();
  await expect.element(screen.getByText('stream open')).toBeInTheDocument();
  const calls = () => network.mock.calls.filter(([input]) => String(input).includes('me.get')).length;

  focusManager.setFocused(false);
  focusManager.setFocused(true);
  await new Promise(resolve => setTimeout(resolve, 100));
  expect(calls()).toBe(0);
  focusManager.setFocused(undefined);
});

test('the first open asks for no catch-up, a reopen does', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  network.mockImplementation(async () => Response.json({ result: { data: { ticket: 't' } } }));
  await mount();
  await vi.waitFor(() => expect(sources).toHaveLength(1));
  sources[0]?.emit({ type: 'connected' });
  expect(received).toEqual([]);

  sources[0]?.onerror?.();
  await vi.advanceTimersByTimeAsync(2_500);
  await vi.waitFor(() => expect(sources).toHaveLength(2));
  sources[1]?.emit({ type: 'connected' });
  expect(received).toEqual(['connected']);
});
