/**
 * A stand-in for `ldapts`, for suites that exercise Luke's LDAP code without a directory.
 *
 * Use it as the factory of the module mock, and script `mockClient` from the test:
 *
 *   vi.mock('ldapts', async importOriginal =>
 *     (await import('./helpers/ldapts')).ldaptsMock(importOriginal));
 */

import { vi } from 'vitest';

/** ldapts's base class for errors carrying an LDAP result code. */
export class MockResultCodeError extends Error {
  constructor(public code: number, message: string) {
    super(message);
  }
}

export class MockInvalidCredentialsError extends MockResultCodeError {
  constructor() {
    super(49, 'Invalid credentials');
    this.name = 'InvalidCredentialsError';
  }
}

/** The one client every `new Client()` returns, so a test can script it before the code connects. */
export const mockClient = {
  bind: vi.fn(),
  search: vi.fn(),
  unbind: vi.fn(),
};

// `function`, not arrow: it's invoked with `new` and arrows aren't constructible.
export const ClientConstructor = vi.fn(function () {
  return mockClient;
});

/**
 * The mocked module. The filter parser and the SASL mechanism list stay the real ones: Luke's code
 * parses a filter itself before anything is sent, and checks a DN against that list.
 */
export async function ldaptsMock(importOriginal: <T>() => Promise<T>) {
  const real = await importOriginal<typeof import('ldapts')>();
  return {
    Client: ClientConstructor,
    InvalidCredentialsError: MockInvalidCredentialsError,
    ResultCodeError: MockResultCodeError,
    FilterParser: real.FilterParser,
    SASL_MECHANISMS: real.SASL_MECHANISMS,
  };
}
