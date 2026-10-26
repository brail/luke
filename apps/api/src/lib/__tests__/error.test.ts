import { describe, expect, it } from 'vitest';

import { prismaKnownError as prismaError } from '../../../test/helpers/prismaError';
import { isUniqueViolation, toErrorMessage } from '../error';

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

  it('keeps a message that is there, and a thrown primitive', () => {
    expect(toErrorMessage(new Error('disk full'))).toBe('disk full');
    expect(toErrorMessage('plain')).toBe('plain');
    expect(toErrorMessage(404)).toBe('404');
  });

  it("reads a plain object's message, and never answers `[object Object]`", () => {
    expect(toErrorMessage({ message: 'from a plain object' })).toBe('from a plain object');
    expect(toErrorMessage({})).toBe('Unknown error');
    expect(toErrorMessage({ message: 42 })).toBe('Unknown error');
    expect(toErrorMessage(undefined)).toBe('Unknown error');
  });
});

/**
 * A duplicate on a named key is Prisma's P2002 naming that index, as the driver adapter reports it
 * (`constraintViolation.integration.spec.ts` reads the shape from a real refusal).
 */
describe('isUniqueViolation', () => {
  it('is the P2002 of the named index', () => {
    expect(isUniqueViolation(prismaError('P2002', 'brands_code_key'), 'brands_code_key')).toBe(true);
  });

  it('is the P2002 of any of the named indexes', () => {
    expect(isUniqueViolation(prismaError('P2002', 'users_username_key'), 'users_email_key', 'users_username_key')).toBe(true);
  });

  it('is not a duplicate on another index, or one whose index it cannot read', () => {
    expect(isUniqueViolation(prismaError('P2002', 'brands_navBrandId_key'), 'brands_code_key')).toBe(false);
    expect(isUniqueViolation(prismaError('P2002'), 'brands_code_key')).toBe(false);
  });

  it('is not a foreign-key refusal, a plain object carrying the code, or anything else', () => {
    expect(isUniqueViolation(prismaError('P2003', 'brands_code_key'), 'brands_code_key')).toBe(false);
    expect(isUniqueViolation({ code: 'P2002' }, 'brands_code_key')).toBe(false);
    expect(isUniqueViolation(new Error('P2002'), 'brands_code_key')).toBe(false);
  });
});
