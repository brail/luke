/**
 * The subset of `pnpm-workspace.yaml` the checkers read, parsed by hand.
 *
 * Not a YAML library: no workspace declares one as a direct dependency, and
 * reaching for a transitive copy would be a dependency this repo has not
 * agreed to. Only top-level scalars, block sequences and a flat block mapping
 * (`overrides`) are understood.
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

/** One entry of a top-level block mapping, with the comment written for it. */
export interface MappingEntry {
  /** The key, unquoted (`uuid@<11.1.1`, `@scope/pkg`). */
  key: string;
  /** The value, unquoted. */
  value: string;
  /** 1-based line of the entry. */
  line: number;
  /** The full-line comments right above the entry and its inline comment, joined. */
  comment: string;
}

const QUOTED = String.raw`'[^']*'|"[^"]*"`;
/** `  key: rest`, the key plain or quoted; the rest is read by `valueAndComment`. */
const MAPPING_ENTRY = new RegExp(String.raw`^[ \t]+(${QUOTED}|[^\s'"#&*!{\[][^:#]*?):[ \t]+(.*)$`);
const QUOTED_VALUE = new RegExp(String.raw`^(${QUOTED})(?:[ \t]+#(.*))?[ \t]*$`);
const unquote = (text: string): string => text.replace(/^(['"])(.*)\1$/, '$2');

/**
 * A scalar value and its inline comment, or null for anything that is not a plain or quoted scalar
 * (a flow collection, an anchor, an alias, a tag, a block scalar, a nested mapping). As in YAML, a
 * `#` starts a comment only after whitespace: `a#b` is a value.
 */
function valueAndComment(rest: string): { value: string; comment: string } | null {
  const quoted = rest.match(QUOTED_VALUE);
  if (quoted) return { value: unquote(quoted[1] ?? ''), comment: quoted[2]?.trim() ?? '' };
  if (/^[\s'"#&*!{[|>]/.test(rest)) return null;
  const hash = rest.search(/[ \t]#/);
  const value = (hash === -1 ? rest : rest.slice(0, hash)).trim();
  if (value === '' || /:[ \t]/.test(value)) return null;
  return { value, comment: hash === -1 ? '' : rest.slice(hash).replace(/^[ \t]+#/, '').trim() };
}

/** `name@selector` → name and selector; a scoped name keeps its leading `@`. */
export function splitSelector(selector: string): { pattern: string; version?: string } {
  const at = selector.lastIndexOf('@');
  if (at > 0) {
    return { pattern: selector.slice(0, at), version: selector.slice(at + 1) };
  }
  return { pattern: selector };
}

/**
 * The entries of a top-level block mapping of plain `key: value` lines, or
 * `null` when the key is absent. Strict, because its callers judge every
 * entry: a flow mapping, a repeated key, a nested mapping, an anchor or alias,
 * or any line it does not recognise throws, so a form it cannot read is never
 * taken for fewer entries.
 *
 * A comment block belongs to the entry right below it: it ends at a blank line
 * or at another entry, so a note written for one override is not lent to the
 * next.
 */
export function mapping(yaml: string, key: string): MappingEntry[] | null {
  const [declaration, ...more] = yaml.match(new RegExp(`^${key}:.*$`, 'gm')) ?? [];
  if (declaration === undefined) return null;
  if (more.length > 0) {
    throw new Error(`\`${key}\` is declared more than once: reading one would ignore the others.`);
  }
  if (!new RegExp(`^${key}:[ \\t]*(?:#.*)?$`).test(declaration)) {
    throw new Error(`\`${key}\` is not a block mapping: \`${declaration.trim()}\`.`);
  }

  // `\r?\n`: on a CRLF file the matched declaration has no `\r`, and a split on `\n` alone would
  // keep one on every line, so the block would never be found.
  const lines = yaml.split(/\r?\n/);
  const start = lines.findIndex(line => line === declaration);
  if (start === -1) {
    throw new Error(`\`${key}\`: its declaration could not be located line by line.`);
  }
  const entries: MappingEntry[] = [];
  const seen = new Set<string>();
  let comment: string[] = [];

  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '') {
      comment = [];
      continue;
    }
    const note = line.match(/^[ \t]*#(.*)$/);
    if (note) {
      comment.push(note[1].trim());
      continue;
    }
    if (/^\S/.test(line)) {
      if (!TOP_LEVEL_KEY.test(line)) {
        throw new Error(`\`${key}\` is followed by a line that is not a top-level key: \`${line.trim()}\`.`);
      }
      break;
    }
    const entry = line.match(MAPPING_ENTRY);
    const scalar = entry ? valueAndComment(entry[2] ?? '') : null;
    if (!entry || !scalar) {
      throw new Error(`\`${key}\` has a line the checks cannot read: \`${line.trim()}\`.`);
    }
    const name = unquote((entry[1] ?? '').trim());
    if (seen.has(name)) {
      throw new Error(`\`${key}\` declares \`${name}\` more than once.`);
    }
    seen.add(name);
    entries.push({
      key: name,
      value: scalar.value,
      line: i + 1,
      comment: [...comment, scalar.comment].join(' ').trim(),
    });
    comment = [];
  }
  return entries;
}
