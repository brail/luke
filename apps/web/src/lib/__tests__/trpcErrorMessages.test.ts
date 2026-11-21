/**
 * `getTrpcErrorMessage` for `SERVICE_UNAVAILABLE`: a 5xx whose text production masks as "Internal
 * server error", so the web shows the text of the reason the server sends in `data.unavailableReason`
 * (#259), and a neutral one when there is none — never maintenance unless the server says so. A raw
 * upload route answers with an HTTP status instead of a tRPC code, and its rate limiter's text is
 * English.
 */

import { describe, expect, it } from 'vitest';

import { AUTH_UNAVAILABLE_MESSAGE, SERVICE_UNAVAILABLE_FALLBACK_MESSAGE } from '@luke/core';

import { getTrpcErrorMessage } from '../trpcErrorMessages';

const MAINTENANCE = 'Sistema in manutenzione. Riprova più tardi.';
const unavailable = (unavailableReason?: unknown) => ({
  message: 'Internal server error',
  data: { code: 'SERVICE_UNAVAILABLE', unavailableReason },
});

describe('getTrpcErrorMessage', () => {
  it('shows the text of the reason the server sends, not the masked text', () => {
    expect(getTrpcErrorMessage(unavailable('maintenance'))).toBe(MAINTENANCE);
    expect(getTrpcErrorMessage(unavailable('auth_unavailable'))).toBe(AUTH_UNAVAILABLE_MESSAGE);
  });

  it('shows the neutral text for a SERVICE_UNAVAILABLE without a reason it knows', () => {
    for (const reason of [undefined, 'something_else', 'toString']) {
      expect(getTrpcErrorMessage(unavailable(reason))).toBe(SERVICE_UNAVAILABLE_FALLBACK_MESSAGE);
    }
  });

  it('lets no screen override SERVICE_UNAVAILABLE', () => {
    // @ts-expect-error the reason alone picks the text
    expect(getTrpcErrorMessage(unavailable('auth_unavailable'), { SERVICE_UNAVAILABLE: 'altro' })).toBe(
      AUTH_UNAVAILABLE_MESSAGE,
    );
  });

  it('shows the shared notices for an HTTP 429 or 503 from a raw route', () => {
    const refusal = (status: number) => Object.assign(new Error('Rate limit exceeded, retry in 1 minute'), { status });
    expect(getTrpcErrorMessage(refusal(429))).toBe('Troppe richieste. Riprova tra qualche istante.');
    expect(getTrpcErrorMessage(refusal(503))).toBe(SERVICE_UNAVAILABLE_FALLBACK_MESSAGE);
  });
});
