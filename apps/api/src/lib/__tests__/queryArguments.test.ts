import { describe, expect, it } from 'vitest';

import { prismaValidationError } from '../../../test/helpers/prismaError';
import { logLineWithoutQueryArguments, withoutQueryArguments } from '../queryArguments';

/** The two forms of the argument block (`../queryArguments.ts`); the real client's: `prismaValidationText.integration.spec.ts`. */

const SENTINEL = 'query-value-sentinel';

/** The code-frame form, as the real client renders it once it resolves the call site. */
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

describe('withoutQueryArguments', () => {
  it('drops the argument tree, keeping the call and the reason', () => {
    expect(withoutQueryArguments(prismaValidationError(SENTINEL).message)).toBe(
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
});

describe('logLineWithoutQueryArguments', () => {
  it('drops the values from every string of the line, and keeps it one JSON line', () => {
    const text = prismaValidationError(SENTINEL).message;
    const line = `${JSON.stringify({
      msg: text,
      err: { message: `failed: ${text}`, stack: `Error: ${text}\n    at x`, aggregateErrors: [{ message: text }] },
      error: text,
    })}\n`;

    const out = logLineWithoutQueryArguments(line);

    expect(out).not.toContain(SENTINEL);
    expect(out.endsWith('}\n')).toBe(true);
    expect(JSON.parse(out).error).toContain('invocation: Unknown argument `notAField`');
  });

  it('drops the rejected row a Postgres refusal quotes, and keeps the rest of the answer', () => {
    const adapterError = { name: 'DriverAdapterError', cause: { kind: 'postgres', code: '23514', detail: `Failing row contains (${SENTINEL}).` } };
    const line = `${JSON.stringify({ err: { type: 'PrismaClientKnownRequestError', meta: { driverAdapterError: adapterError } } })}\n`;

    const out = logLineWithoutQueryArguments(line);

    expect(out).not.toContain(SENTINEL);
    expect(JSON.parse(out).err.meta.driverAdapterError.cause).toEqual({ kind: 'postgres', code: '23514' });
  });

  it('hands back any other line untouched', () => {
    const line = '{"level":30,"msg":"Email sent"}\n';

    expect(logLineWithoutQueryArguments(line)).toBe(line);
  });

  it('stays linear in a text full of calls that never end their tree, as a log line of user input can', () => {
    const input = 'Invalid `prisma.x.y()` invocation:\n\n{\n  a: 1\n'.repeat(40_000);

    const started = performance.now();
    expect(withoutQueryArguments(input)).toBe(input);
    // Linear: a few milliseconds for 1.8 MB. The quadratic scan this replaces took seconds.
    expect(performance.now() - started).toBeLessThan(500);
  });

  it('withholds a line it cannot read rather than throw or write its values', () => {
    const out = logLineWithoutQueryArguments(`not json: Invalid \`prisma.user.create()\` invocation ${SENTINEL}\n`);

    expect(out).not.toContain(SENTINEL);
    expect(JSON.parse(out)).toMatchObject({ level: 50 });
  });
});
