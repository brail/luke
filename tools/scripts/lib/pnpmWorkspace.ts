/**
 * The subset of `pnpm-workspace.yaml` the checkers read, parsed by hand.
 *
 * Not a YAML library: no workspace declares one as a direct dependency, and
 * reaching for a transitive copy would be a dependency this repo has not
 * agreed to. Only top-level scalars and block sequences are understood.
 *
 * Shared because two checkers read the same file — `check-platform-integrity`
 * for the supply-chain policy keys, `check-docs-integrity` for the workspace
 * globs — and a rule shared by two scripts belongs in one place. What absence
 * means stays with each caller: the platform policy tolerates a missing key,
 * workspace discovery refuses one.
 */

/** A top-level `key: value` scalar, or `null` when the key is absent. */
export function scalar(yaml: string, key: string): string | null {
  return yaml.match(new RegExp(`^${key}:[ \\t]*(\\S.*?)\\s*$`, 'm'))?.[1] ?? null;
}

/** A column-0 mapping key: the only line a strict block may end on. */
const TOP_LEVEL_KEY = /^(?:[A-Za-z_][\w.-]*|'[^']*'|"[^"]*"):(?:[ \t]|$)/;

/**
 * The items of a top-level block sequence, or `null` when the key is absent or
 * not written as a block (`key: [a, b]`, `key: # note`).
 *
 * The block ends at the next line that starts in column 0. A full-line comment
 * does not end it, however it is indented: it used to, so a `# note` in column
 * 0 between two items silently dropped every item after it.
 *
 * By default every other line is tolerated — an indented non-item is skipped,
 * any column-0 line ends the block, and a repeated key answers from its first
 * declaration — which is what the platform policy readers have always relied
 * on. `strict` is for a caller that must not act on a partial list: it throws
 * on a repeated key, an indented line that is not an item, an item in column
 * 0, and a column-0 line that is not a top-level key, so only a top-level key
 * ends a strict block.
 */
export function sequence(
  yaml: string,
  key: string,
  { strict = false }: { strict?: boolean } = {}
): string[] | null {
  const declarations = yaml.match(new RegExp(`^${key}:(?:[ \\t]|$)`, 'gm')) ?? [];
  if (strict && declarations.length > 1) {
    throw new Error(
      `\`${key}\` is declared more than once: reading one declaration would ` +
        'ignore the others.'
    );
  }
  const start = yaml.match(new RegExp(`^${key}:[ \\t]*$`, 'm'));
  if (start?.index === undefined) return null;
  const items: string[] = [];
  for (const line of yaml.slice(start.index).split('\n').slice(1)) {
    if (/^[ \t]*#/.test(line)) continue;
    const item = line.match(/^[ \t]+-[ \t]+(.*?)\s*$/);
    if (!item) {
      if (/^\S/.test(line)) {
        if (strict && line.startsWith('-')) {
          throw new Error(
            `\`${key}\` contains an item that is not indented: \`${line.trim()}\`.`
          );
        }
        if (strict && !TOP_LEVEL_KEY.test(line)) {
          throw new Error(
            `\`${key}\` is followed by a line that is neither a comment nor a ` +
              `top-level key: \`${line.trim()}\`.`
          );
        }
        break;
      }
      if (strict && line.trim() !== '') {
        throw new Error(
          `\`${key}\` contains a line that is not a sequence item: \`${line.trim()}\`.`
        );
      }
      continue;
    }
    items.push(item[1].replace(/^['"]|['"]$/g, ''));
  }
  return items;
}
