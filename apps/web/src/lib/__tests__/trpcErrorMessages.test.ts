/**
 * `getTrpcErrorMessage` for maintenance mode: the server answers SERVICE_UNAVAILABLE, a 5xx whose
 * text production masks as "Internal server error", so the web supplies its own. A raw upload route
 * answers with an HTTP status instead of a tRPC code, and its rate limiter's text is English.
 */

import { describe, expect, it } from 'vitest';

import { getTrpcErrorMessage } from '../trpcErrorMessages';

describe('getTrpcErrorMessage', () => {
  it('shows the maintenance notice for SERVICE_UNAVAILABLE instead of the masked text', () => {
    expect(
      getTrpcErrorMessage({ message: 'Internal server error', data: { code: 'SERVICE_UNAVAILABLE' } }),
    ).toBe('Sistema in manutenzione. Riprova più tardi.');
  });

  it('shows the same notices for an HTTP 429 or 503 from a raw route', () => {
    const refusal = (status: number) => Object.assign(new Error('Rate limit exceeded, retry in 1 minute'), { status });
    expect(getTrpcErrorMessage(refusal(429))).toBe('Troppe richieste. Riprova tra qualche istante.');
    expect(getTrpcErrorMessage(refusal(503))).toBe('Sistema in manutenzione. Riprova più tardi.');
  });
});
