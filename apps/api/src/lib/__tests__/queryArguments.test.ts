import { describe, expect, it } from 'vitest';

import { prismaValidationError } from '../../../test/helpers/prismaError';
import { logLineWithoutQueryArguments } from '../queryArguments';

/** The log-line hook (`../queryArguments.ts`); the text forms are tested in `@luke/core`, the real client's in `prismaValidationText.integration.spec.ts`. */

const SENTINEL = 'query-value-sentinel';

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

  it('withholds a line it cannot read rather than throw or write its values', () => {
    const out = logLineWithoutQueryArguments(`not json: Invalid \`prisma.user.create()\` invocation ${SENTINEL}\n`);

    expect(out).not.toContain(SENTINEL);
    expect(JSON.parse(out)).toMatchObject({ level: 50 });
  });
});
