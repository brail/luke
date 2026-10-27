/**
 * The log-line side of keeping Prisma's query values out of text that leaves the process (#104):
 * stored text goes through `toErrorMessage`, every root-logger line through this hook. What Prisma
 * renders, and how it is taken out: `withoutQueryArguments` in `@luke/core`.
 */

import { withoutQueryArguments } from '@luke/core';

/** What a line that cannot be cleaned becomes: withheld, rather than written with its values. */
const WITHHELD_LINE = '{"level":50,"msg":"A log line naming a Prisma call could not be cleaned and was withheld"}\n';

/**
 * A JSON log line without the query values a Prisma error renders, in every string it holds —
 * message, stack, cause chain, any key the call site chose — and without the row a Postgres refusal
 * quotes (`Failing row contains (…)`, the `detail` the driver adapter puts on any Prisma error's
 * `meta`). Only a line that names a Prisma call or carries an adapter error is parsed again. It never
 * throws: pino calls it inside the log call, so a throw would reach the caller.
 */
export function logLineWithoutQueryArguments(line: string): string {
  if (!line.includes('` invocation') && !line.includes('"driverAdapterError"')) return line;
  try {
    // ponytail: re-serialised through JSON, so on such a line a BigInt above 2^53 loses precision and
    // a repeated key keeps its last value; a regex over the escaped JSON text would avoid both.
    const clean: unknown = JSON.parse(line, (key, value: unknown) => {
      if (typeof value === 'string') return withoutQueryArguments(value);
      if (
        key === 'driverAdapterError' &&
        typeof value === 'object' &&
        value !== null &&
        'cause' in value &&
        typeof value.cause === 'object' &&
        value.cause !== null
      ) {
        Reflect.deleteProperty(value.cause, 'detail');
      }
      return value;
    });
    return `${JSON.stringify(clean)}\n`;
  } catch {
    return WITHHELD_LINE;
  }
}
