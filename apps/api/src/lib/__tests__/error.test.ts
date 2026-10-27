import { describe, expect, it } from 'vitest';

import { prismaKnownError as prismaError, prismaValidationError } from '../../../test/helpers/prismaError';
import { isUniqueViolation, toErrorMessage } from '../error';

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

/** `toErrorMessage` lives in `@luke/core`; here, on a real Prisma error class, through the API's re-export. */
describe('toErrorMessage on a Prisma validation error', () => {
  it('keeps the call and the reason, without the query values', () => {
    const message = toErrorMessage(prismaValidationError('query-value-sentinel'));

    expect(message).toContain('invocation: Unknown argument `notAField`');
    expect(message).not.toContain('query-value-sentinel');
  });
});
