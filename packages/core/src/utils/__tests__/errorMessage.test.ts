import { describe, expect, it } from 'vitest';

import { toErrorMessage, withoutQueryArguments } from '../errorMessage.js';

/**
 * A caught error always yields a readable message. Node's dual-stack connect failure is an
 * `AggregateError` with an empty `message`: two backups failed with an empty `errorMessage` (#49).
 */

function errno(message: string, code: string): Error {
  return Object.assign(new Error(message), { code });
}

const SENTINEL = 'query-value-sentinel';

/** The argument-tree form of a Prisma validation error (`minimal`, production's format). */
const AS_TREE = [
  '',
  'Invalid `prisma.user.findFirst()` invocation:',
  '',
  '{',
  '  where: {',
  `    username: "${SENTINEL}",`,
  '    notAField: "x",',
  '    ~~~~~~~~~',
  '?   id?: StringFilter | String',
  '  }',
  '}',
  '',
  'Unknown argument `notAField`. Available options are marked with ?.',
].join('\n');

/** The code-frame form, as the client renders it once it resolves the call site. */
const WITH_CALL_SITE = [
  '',
  'Invalid `ctx.prisma.user.findFirst()` invocation in',
  '/app/src/services/user.service.ts:26:23',
  '',
  '  23 .mutation(({ ctx }) =>',
  '→ 26   ctx.prisma.user.findFirst({',
  '         where: {',
  `           username: "${SENTINEL}",`,
  '           notAField: "x",',
  '           ~~~~~~~~~',
  '       ?   id?: StringFilter | String',
  '         }',
  '       })',
  '',
  'Unknown argument `notAField`. Available options are marked with ?.',
].join('\n');

describe('toErrorMessage', () => {
  it('names the inner failures of an AggregateError whose own message is empty', () => {
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

  it("keeps a Prisma error's call and reason, without the values its arguments carry", () => {
    const message = toErrorMessage(new Error(AS_TREE));

    expect(message).toContain('invocation: Unknown argument `notAField`');
    expect(message).not.toContain(SENTINEL);
  });
});

describe('withoutQueryArguments', () => {
  it('drops the argument tree, keeping the call and the reason', () => {
    expect(withoutQueryArguments(AS_TREE)).toBe(
      '\nInvalid `prisma.user.findFirst()` invocation: Unknown argument `notAField`. Available options are marked with ?.'
    );
  });

  it('drops the code frame of a resolved call site', () => {
    expect(withoutQueryArguments(WITH_CALL_SITE)).toBe(
      '\nInvalid `ctx.prisma.user.findFirst()` invocation: Unknown argument `notAField`. Available options are marked with ?.'
    );
  });

  it('leaves an error without arguments as it is, its reason included, whatever text follows', () => {
    const knownRequest =
      'failed: \nInvalid `prisma.user.create()` invocation:\n\n\nUnique constraint failed on the fields: (`username`)\n\nretry scheduled';
    const frameOnly =
      'Invalid `prisma.user.create()` invocation in\n/app/x.ts:3:1\n\n  1 import\n→ 3 prisma.user.create(\nUnique constraint failed\n\nlater';

    expect(withoutQueryArguments(knownRequest)).toBe(knownRequest);
    expect(withoutQueryArguments(frameOnly)).toBe(frameOnly);
  });

  it('stays linear in a text full of calls that never end their tree, as a log line of user input can', () => {
    const input = 'Invalid `prisma.x.y()` invocation:\n\n{\n  a: 1\n'.repeat(40_000);

    const started = Date.now();
    expect(withoutQueryArguments(input)).toBe(input);
    // Linear: a few milliseconds for 1.8 MB. The quadratic scan this replaced took seconds.
    expect(Date.now() - started).toBeLessThan(500);
  });
});
