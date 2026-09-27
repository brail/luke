/**
 * `getTrpcErrorMessage` for maintenance mode: the server answers SERVICE_UNAVAILABLE, a 5xx whose
 * text production masks as "Internal server error", so the web supplies its own.
 */

import { describe, expect, it } from 'vitest';

import { getTrpcErrorMessage } from '../trpcErrorMessages';

describe('getTrpcErrorMessage', () => {
  it('shows the maintenance notice for SERVICE_UNAVAILABLE instead of the masked text', () => {
    expect(
      getTrpcErrorMessage({ message: 'Internal server error', data: { code: 'SERVICE_UNAVAILABLE' } }),
    ).toBe('Sistema in manutenzione. Riprova più tardi.');
  });
});
