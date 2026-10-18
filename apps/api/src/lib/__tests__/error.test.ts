import { describe, expect, it } from 'vitest';

import { toErrorMessage } from '../error';

/**
 * A caught error always yields a readable message. Node's dual-stack connect failure is an
 * `AggregateError` with an empty `message`: two backups failed with an empty `errorMessage` (#49).
 */

function errno(message: string, code: string): Error {
  return Object.assign(new Error(message), { code });
}

describe('toErrorMessage', () => {
  it("names the inner failures of an AggregateError whose own message is empty", () => {
    const err = Object.assign(
      new AggregateError([errno('connect ECONNREFUSED ::1:9000', 'ECONNREFUSED'), errno('connect ECONNREFUSED 127.0.0.1:9000', 'ECONNREFUSED')], ''),
      { code: 'ECONNREFUSED' },
    );

    expect(toErrorMessage(err)).toBe('connect ECONNREFUSED ::1:9000; connect ECONNREFUSED 127.0.0.1:9000');
  });

  it('falls back to the name and code of an error with an empty message', () => {
    expect(toErrorMessage(errno('', 'ECONNRESET'))).toBe('Error: ECONNRESET');
    expect(toErrorMessage(new TypeError(''))).toBe('TypeError');
  });

  it('keeps a message that is there, and stringifies what is not an Error', () => {
    expect(toErrorMessage(new Error('disk full'))).toBe('disk full');
    expect(toErrorMessage('plain')).toBe('plain');
  });
});
