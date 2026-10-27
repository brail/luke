/**
 * Readable error text, safe to store or show: one way to read a caught value's message, without the
 * query values a Prisma error renders.
 *
 * Prisma renders a call's arguments, values included, into the text of its errors: between
 * `Invalid \`prisma.user.create()\` invocation` and the reason sits either the argument tree (the
 * `minimal` format production runs, or `colorless` without a call site) or the call site's location
 * and a code frame holding the same arguments (`colorless` with one, the default outside
 * production). `pretty`, whose colour codes would hide the call, is never used (#104).
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

/**
 * Extracts a readable message from any caught value. An empty `message` falls back to what else the
 * error carries: Node's dual-stack connect failure is an `AggregateError` whose own message is
 * empty, with the real reasons in `errors` (#49). A thrown primitive is its own text and a plain
 * object gives its string `message`, never `[object Object]`; nothing at all is `Unknown error`. A
 * Prisma error keeps its call and reason, without the query values (`withoutQueryArguments`).
 */
export function toErrorMessage(err: unknown): string {
  return withoutQueryArguments(readMessage(err));
}

function readMessage(err: unknown): string {
  if (err === undefined || err === null) return 'Unknown error';
  if (typeof err !== 'object') return String(err) || 'Unknown error';
  if ('message' in err && typeof err.message === 'string' && err.message) return err.message;
  if (err instanceof AggregateError && err.errors.length > 0) return err.errors.map(readMessage).join('; ');
  if (!(err instanceof Error)) return 'Unknown error';
  return 'code' in err && typeof err.code === 'string' ? `${err.name}: ${err.code}` : err.name;
}
