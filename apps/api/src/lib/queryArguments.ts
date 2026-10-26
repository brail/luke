/**
 * Prisma renders a call's arguments, values included, into the text of its errors: between
 * `Invalid \`prisma.user.create()\` invocation` and the reason sits either the argument tree (the
 * `minimal` format production runs, or `colorless` without a call site) or the call site's location
 * and a code frame holding the same arguments (`colorless` with one, the default outside
 * production). This module takes them out of text that leaves the process — stored error text and
 * log lines (#104). `pretty`, whose colour codes would hide the call, is never used here. Log lines
 * also lose the rejected row Postgres attaches to some refusals.
 */

/** A call and the opening of its block: the argument tree (group 2), or a call site's location. */
const HEADER = /(Invalid `[^`\n]+` invocation)(?:(:\n\n\{\n)| in\n[^\n]*\n\n)/g;

/** The tree runs to the first `}` at the start of a line, then a blank line before the reason. */
const TREE_END = '\n}\n\n';

/** A code frame's lines start with a space or `→`; a blank line separates them from the reason. */
const FRAME_LINES = /(?:[ →][^\n]*\n)+\n/y;

/**
 * `text` without the arguments a Prisma error renders: the call and the reason stay
 * (`Invalid \`prisma.user.create()\` invocation: Argument \`role\` is missing.`). An error with no
 * block (a known-request error, a frame without arguments) and any other text are returned as they
 * are. Linear in the text, however many calls it names: a log line can carry user input.
 */
export function withoutQueryArguments(text: string): string {
  let out = '';
  let kept = 0;
  // With no tree end after one call, none can follow a later call either: trees are not looked for
  // again, so no call rescans the rest of the text.
  let treeCanEnd = true;
  HEADER.lastIndex = 0;
  for (let call = HEADER.exec(text); call; call = HEADER.exec(text)) {
    const blockStart = HEADER.lastIndex;
    let end = -1;
    if (call[2]) {
      const close: number = treeCanEnd ? text.indexOf(TREE_END, blockStart) : -1;
      treeCanEnd = close !== -1;
      if (close !== -1) end = close + TREE_END.length;
    } else {
      FRAME_LINES.lastIndex = blockStart;
      if (FRAME_LINES.test(text)) end = FRAME_LINES.lastIndex;
    }
    if (end === -1) {
      HEADER.lastIndex = call.index + 1;
      continue;
    }
    out += `${text.slice(kept, call.index)}${call[1]}: `;
    kept = end;
    HEADER.lastIndex = end;
  }
  return kept === 0 ? text : out + text.slice(kept);
}

/** What a line that cannot be cleaned becomes: withheld, rather than written with its values. */
const WITHHELD_LINE = '{"level":50,"msg":"A log line naming a Prisma call could not be cleaned and was withheld"}\n';

/**
 * The same for a JSON log line, in every string it holds — message, stack, cause chain, any key the
 * call site chose — and without the row a Postgres refusal quotes (`Failing row contains (…)`, the
 * `detail` the driver adapter puts on any Prisma error's `meta`). Only a line that names a Prisma
 * call or carries an adapter error is parsed again. It never throws: pino calls it inside the log
 * call, so a throw would reach the caller.
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
