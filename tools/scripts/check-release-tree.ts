/**
 * Deterministic gate binding a release tree to the tag that publishes it: does
 * the exact tree a tag names actually *claim* the version that tag carries?
 *
 * ## Why it exists, and why it is not part of the provenance gate
 *
 * `check-release-provenance.ts` answers a topology question — which git line a
 * tag comes from, and therefore which registry tags it may publish. It says
 * nothing about the tree's contents. Nothing on the authoritative side did:
 * `release.yml` published an image whose `package.json` versions and whose
 * release notes had never been compared with the tag. The only checks that
 * existed lived in `.husky/pre-push`, which is skipped by `--no-verify` and
 * absent from any clone that never ran `pnpm install`.
 *
 * Those hook checks also asked the wrong question. Both of them read the
 * **working tree**, and the version half resolved its expectation with
 * `git describe --tags --abbrev=0` — the topologically *nearest* tag, not the
 * tag being pushed. Measured consequences: a second tag on the same commit
 * makes `describe` answer with the other tag and the check fails a correct
 * tree; pushing an older, still-correct tag after HEAD has moved on fails a
 * legitimate push; with no tag reachable it compares against `0.0.0-<branch>`.
 * There was no way to bind it to a tag at all — `--check` takes no version and
 * is declared incompatible with `--set`.
 *
 * So the two questions are two modules, sharing one parser rather than one
 * file. Provenance decides *whether this line may publish this tag*; this
 * decides *whether this tree claims it*. `release.yml` runs them back to back
 * in the same job, and this one reads the very commit the gate authorised.
 *
 * ## What it proves
 *
 * For `parseReleaseTag(tag).version` — `X.Y.Z`, or `X.Y.Z-rc.N` for a
 * candidate:
 *
 * - every governed `package.json` declares exactly that version. The governed
 *   set is derived from the `packages:` globs in `pnpm-workspace.yaml` **read
 *   from the same tree**, plus the root manifest — not from a hard-coded list,
 *   and not from the workspace file of whatever happens to be checked out;
 * - `CHANGELOG.md` has exactly one `## [<version>]` heading, optionally dated,
 *   and its section carries at least one `- ` entry.
 *
 * Every one of those is a fail-closed rejection. A release that is prepared
 * correctly passes unchanged; only a tree that does not claim its own tag is
 * refused, and it is refused before any image exists.
 *
 * ## Reading one tree and no other
 *
 * `--rev` resolves the revision to a single tree object once and reads
 * everything out of it with git plumbing (`ls-tree`, `cat-file`). It never
 * touches HEAD, the index or the working tree — which is the whole point, since
 * the tagged tree and the checked-out tree routinely differ (at `v2.1.4` the
 * repository had 7 workspace manifests; the train has 8). Commit SHAs,
 * lightweight tags and annotated tag objects all resolve, because `^{tree}`
 * peels through a tag object to its commit and on to the tree.
 *
 * `--worktree` reads the tracked working tree instead, and exists for exactly
 * one caller: `release-prepare.sh` checks what it has just written, at a moment
 * when no tag and no commit exist yet.
 *
 * Usage:
 *   tsx tools/scripts/check-release-tree.ts --tag v2.2.0-rc.1 --rev <revision>
 *   tsx tools/scripts/check-release-tree.ts --tag v2.2.0-rc.1 --worktree
 *   (optional: --repo <path>, defaults to the current directory)
 *
 * Run by `release.yml` after the provenance gate (authoritative), by
 * `.husky/pre-push` on the object being pushed (early feedback, not
 * enforcement) and by `scripts/release-prepare.sh` as a self-check.
 * Regression-tested by `check-release-tree.test.ts` (`pnpm test:tools`).
 */

import { execFileSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

import { parseReleaseTag } from './check-release-provenance';

/** A rejection. Distinct type so the tests assert on the gate, not on any throw. */
export class ReleaseTreeError extends Error {}

/**
 * A cap, not an allocation. `ls-tree -r` over this repository is ~47 KB today,
 * comfortably inside the 1 MiB default — but the default's failure mode is an
 * ENOBUFS raised from a release gate, whose message would say nothing about
 * size, so the headroom is deliberate.
 */
const MAX_BUFFER = 64 * 1024 * 1024;

function git(repo: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd: repo,
    encoding: 'utf-8',
    maxBuffer: MAX_BUFFER,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/**
 * One tree, read through one interface, so the contract below cannot express
 * "check the tagged tree but read this file from the worktree". Each `describe`
 * says which tree it actually is, and that string is what the summary line and
 * the rejections quote.
 */
export interface ReleaseTree {
  /** What was read, for the summary line and the rejection messages. */
  readonly describe: string;
  /** Every tracked path in the tree, repository-root relative. */
  readonly paths: ReadonlySet<string>;
  /** Contents of a path that `paths` lists. Throws for anything else. */
  read(path: string): string;
}

/** The NUL-delimited listing both trees enumerate themselves with. */
function trackedPaths(repo: string, args: string[]): ReadonlySet<string> {
  return new Set(
    git(repo, args)
      .split('\0')
      .filter(path => path !== '')
  );
}

/**
 * The tree a revision names, and nothing else.
 *
 * The revision is resolved to a tree object **once**, and every subsequent read
 * is addressed to that object rather than re-resolving the revision. A ref that
 * moved between two reads therefore cannot be observed half-way, and there is
 * no code path left that could name HEAD.
 */
export function revTree(repo: string, rev: string): ReleaseTree {
  if (rev.startsWith('-')) {
    throw new ReleaseTreeError(
      `"${rev}" cannot be a revision: a leading "-" would be read by git as an option.`
    );
  }

  let tree: string;
  try {
    tree = git(repo, [
      'rev-parse',
      '--verify',
      '--quiet',
      `${rev}^{tree}`,
    ]).trim();
  } catch (err) {
    // `rev-parse --verify --quiet` exits 1 for "no such object". Anything else
    // — a missing repository, a corrupt object database — is a real failure and
    // must not be collapsed into "unresolvable", which reads like a verdict.
    const status = (err as { status?: number }).status;
    if (status !== 1) throw err;
    throw new ReleaseTreeError(
      `"${rev}" does not resolve to a tree in ${repo}. The revision must be ` +
        'fetched: a commit SHA, a lightweight tag or an annotated tag object.'
    );
  }

  return {
    describe: `${rev} (tree ${tree.slice(0, 12)})`,
    paths: trackedPaths(repo, ['ls-tree', '-r', '--name-only', '-z', tree]),
    read(path) {
      // `<tree>:<path>` always starts with the resolved SHA, so a path that
      // begins with `-` can never be read as an option.
      return git(repo, ['cat-file', 'blob', `${tree}:${path}`]);
    },
  };
}

/**
 * The tracked working tree, for `release-prepare.sh` alone: it verifies what it
 * has just written, at a point where the version exists in no commit and no tag.
 */
export function worktreeTree(repo: string): ReleaseTree {
  return {
    describe: `the working tree of ${repo}`,
    // Listed from the index and read from disk: "tracked" is the index's
    // answer, and the content is whatever the writers have just produced.
    paths: trackedPaths(repo, ['ls-files', '-z', '--full-name']),
    read(path) {
      const full = join(repo, path);
      if (!existsSync(full)) {
        throw new ReleaseTreeError(
          `${path} is tracked but absent from the working tree — a release ` +
            'cannot be prepared from a partially deleted checkout.'
        );
      }
      return readFileSync(full, 'utf-8');
    },
  };
}

/** A version is data. It reaches a pattern only after this. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const WORKSPACE_FILE = 'pnpm-workspace.yaml';
const ROOT_MANIFEST = 'package.json';
const CHANGELOG = 'CHANGELOG.md';

/**
 * The `packages:` sequence of `pnpm-workspace.yaml`, and only that.
 *
 * A YAML parser is not a dependency this control plane is willing to take for
 * one top-level list, so the grammar accepted here is deliberately tiny: a
 * `packages:` key at column zero followed by `  - <glob>` items. Everything a
 * real YAML file may legally contain and this does not understand — a flow
 * sequence, an anchor, a tab indent, a second `packages:` key — is **rejected**
 * rather than silently read as an empty list. Failing open here would mean
 * governing zero manifests and reporting success.
 */
export function parseWorkspaceGlobs(yaml: string): string[] {
  const lines = yaml.split(/\r?\n/);
  const keys = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => /^packages:/.test(line));

  if (keys.length === 0) {
    throw new ReleaseTreeError(
      `${WORKSPACE_FILE} declares no top-level \`packages:\` key, so the set of ` +
        'governed manifests is undefined.'
    );
  }
  if (keys.length > 1) {
    throw new ReleaseTreeError(
      `${WORKSPACE_FILE} declares \`packages:\` ${keys.length} times (lines ` +
        `${keys.map(k => k.index + 1).join(', ')}). Refusing to guess which one governs.`
    );
  }

  const start = keys[0].index;
  const inline = lines[start].slice('packages:'.length).trim();
  if (inline !== '' && !inline.startsWith('#')) {
    throw new ReleaseTreeError(
      `${WORKSPACE_FILE}:${start + 1} — \`packages:\` carries an inline value ` +
        `(${inline}). Only a block sequence of \`  - <glob>\` items is understood.`
    );
  }

  const globs: string[] = [];
  let indent: string | null = null;

  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;

    const item = /^([ ]+)-[ ]+(.*)$/.exec(line);
    if (item === null) {
      // The first line that is neither blank, comment nor item ends the
      // sequence — unless it is indented, in which case it is a nested
      // construct this parser does not understand and must not skip past.
      if (/^\s/.test(line)) {
        throw new ReleaseTreeError(
          `${WORKSPACE_FILE}:${i + 1} — "${line.trim()}" is not a \`- <glob>\` item. ` +
            'Only a plain block sequence is understood.'
        );
      }
      break;
    }

    if (indent === null) indent = item[1];
    if (item[1] !== indent) {
      throw new ReleaseTreeError(
        `${WORKSPACE_FILE}:${i + 1} — inconsistent indentation in the \`packages:\` ` +
          'sequence. Only a flat list of items at one indent is understood.'
      );
    }

    // A trailing `# comment` is YAML; a quoted scalar is too. Nothing else.
    const value = item[2]
      .replace(/\s+#.*$/, '')
      .trim()
      .replace(/^'(.*)'$/, '$1')
      .replace(/^"(.*)"$/, '$1');

    if (value === '') {
      throw new ReleaseTreeError(
        `${WORKSPACE_FILE}:${i + 1} — empty \`packages:\` entry.`
      );
    }
    globs.push(value);
  }

  if (globs.length === 0) {
    throw new ReleaseTreeError(
      `${WORKSPACE_FILE} declares \`packages:\` with no entries, so no workspace ` +
        'manifest would be governed.'
    );
  }
  return globs;
}

/**
 * `apps/*` and `packages/*`: a fixed prefix and one `*` standing for a single
 * directory level. That is the whole shape this repository uses, and a shape it
 * does not use fails closed — `apps/**` would silently change which manifests
 * are governed, and a checker that guesses at that is worse than one that stops.
 *
 * `.` and `..` segments are refused by name rather than left to fail later.
 * `../*` would already have been rejected — no path git lists starts with `../`,
 * so it discovers nothing — but it would have been rejected for the wrong
 * reason, and "this glob governs nothing" reads like a workspace that moved
 * rather than a glob reaching outside the repository.
 */
const DIRECT_CHILD_GLOB = /^(?!\/)(?:(?!\.\.?\/)[^*?[\]{}!/\s]+\/)+\*$/;

function manifestPattern(glob: string): RegExp {
  const prefix = glob.slice(0, -1);
  return new RegExp(`^${escapeRegExp(prefix)}[^/]+/package\\.json$`);
}

/**
 * Every `package.json` the release governs: the root, plus one per workspace
 * member named by the globs.
 *
 * The per-glob zero-discovery guard is the point. `sync-version.js` guards only
 * the *total* (`found.length < 2`), so a monorepo that still had `apps/` would
 * pass with `packages/` silently contributing nothing. Here a configured glob
 * that discovers no manifest is a rejection: either the workspace moved and
 * this checker must be updated, or the tree is not the one anybody meant.
 */
export function governedManifests(tree: ReleaseTree): string[] {
  const paths = tree.paths;

  if (!paths.has(WORKSPACE_FILE)) {
    throw new ReleaseTreeError(
      `${WORKSPACE_FILE} is not in ${tree.describe}, so which manifests the ` +
        'release governs cannot be established.'
    );
  }
  if (!paths.has(ROOT_MANIFEST)) {
    throw new ReleaseTreeError(`${ROOT_MANIFEST} is not in ${tree.describe}.`);
  }

  const found = new Set<string>([ROOT_MANIFEST]);

  for (const glob of parseWorkspaceGlobs(tree.read(WORKSPACE_FILE))) {
    if (!DIRECT_CHILD_GLOB.test(glob)) {
      throw new ReleaseTreeError(
        `${WORKSPACE_FILE} declares the workspace glob "${glob}", which is not a ` +
          'direct-child glob of the form `<dir>/*`. Refusing to guess which ' +
          'manifests it governs.'
      );
    }

    const pattern = manifestPattern(glob);
    const matches = [...paths].filter(path => pattern.test(path));
    if (matches.length === 0) {
      throw new ReleaseTreeError(
        `the workspace glob "${glob}" discovers no package.json in ${tree.describe}. ` +
          'A glob that governs nothing is drift, not an empty set.'
      );
    }
    for (const match of matches) found.add(match);
  }

  return [...found].sort();
}

function manifestVersion(tree: ReleaseTree, path: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(tree.read(path));
  } catch (err) {
    throw new ReleaseTreeError(
      `${path} is not valid JSON in ${tree.describe}: ${(err as Error).message}`
    );
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new ReleaseTreeError(`${path} does not contain a JSON object.`);
  }
  if (!('version' in parsed)) {
    throw new ReleaseTreeError(
      `${path} declares no \`version\`. Every governed manifest must share ` +
        "the release tree's single declared release identity."
    );
  }

  const version = parsed.version;
  if (typeof version !== 'string' || version.trim() === '') {
    throw new ReleaseTreeError(
      `${path} declares \`version\` as ${JSON.stringify(version)}, which is not a ` +
        'version string.'
    );
  }
  return version;
}

/**
 * git-cliff emits `## [Unreleased]` whenever it runs without `--tag`, which is
 * exactly what the `changelog:bump` / `changelog:tag` scripts do. A later
 * `release:prepare` then prepends `## [X.Y.Z]` **above** it, the section
 * contract is satisfied by the new heading, and the release ships the same
 * entries twice under two headings. A release tree has no unreleased section.
 *
 * Any level-two heading that *begins* with `## [Unreleased]`, in any case:
 * git-cliff writes the bare form, but a dated or annotated variant is the same
 * section and must not slip through on its suffix. `###` group headings and
 * prose that merely mentions the string are not headings and are left alone.
 */
const UNRELEASED = /^##[ \t]+\[unreleased\]/i;

/**
 * Entries under the `## [version]` section, or a rejection saying why not.
 *
 * Pure, and separated from every file and git concern, because this is the part
 * with the interesting failure modes. The awk program it replaces accepted two
 * of them: duplicate headings merged silently into one section, and an empty
 * final section borrowed the bullets of the `## Pre-1.9.0 history` footer,
 * because only `## [` terminated a section. Both are release notes that ship
 * blank or wrong.
 */
export function changelogSection(text: string, version: string): number {
  const lines = text.split(/\r?\n/);

  const unreleased = lines.findIndex(line => UNRELEASED.test(line));
  if (unreleased !== -1) {
    throw new ReleaseTreeError(
      `${CHANGELOG}:${unreleased + 1} still carries an "## [Unreleased]" heading. ` +
        'A release tree has none: regenerate with `pnpm release:prepare <tag>`, ' +
        'which ' +
        'always writes a versioned heading.'
    );
  }

  // The closing bracket is part of the prefix, which is what keeps `rc.10` from
  // answering for `rc.1` and `X.Y.Z-rc.N` from answering for `X.Y.Z`.
  const prefix = `## [${version}]`;
  // The two are written together because they must agree: the literal decides
  // *which* lines are this version's heading, the anchored pattern decides
  // whether such a line is well formed. Both accepted forms are what git-cliff
  // and the hand-curated sections emit.
  const accepted = new RegExp(
    `^## \\[${escapeRegExp(version)}\\](?: - \\d{4}-\\d{2}-\\d{2})?$`
  );
  const headings: number[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/[ \t]+$/, '');
    if (!line.startsWith(prefix)) continue;
    if (!accepted.test(line)) {
      throw new ReleaseTreeError(
        `${CHANGELOG}:${i + 1} — "${lines[i]}" is a malformed heading for ${version}. ` +
          `Accepted: "## [${version}]" or "## [${version}] - YYYY-MM-DD".`
      );
    }
    headings.push(i);
  }

  if (headings.length === 0) {
    throw new ReleaseTreeError(
      `${CHANGELOG} has no "## [${version}]" heading, so this tree publishes no ` +
        'notes for the version its tag names.'
    );
  }
  if (headings.length > 1) {
    throw new ReleaseTreeError(
      `${CHANGELOG} has ${headings.length} "## [${version}]" headings (lines ` +
        `${headings.map(i => i + 1).join(', ')}). Remove the duplicated section — ` +
        'a second `release:prepare <tag>` for the same version produces this.'
    );
  }

  let entries = 0;
  for (let i = headings[0] + 1; i < lines.length; i++) {
    const line = lines[i];
    // Every following heading ends the section, not merely another `## [`
    // version: `## Pre-1.9.0 history` is a heading too and its bullets are not
    // this release's. `---` ends it for the same reason.
    if (line.startsWith('## ') || /^---[ \t]*$/.test(line)) break;
    if (line.startsWith('- ')) entries++;
  }

  if (entries === 0) {
    throw new ReleaseTreeError(
      `the "## [${version}]" section of ${CHANGELOG} carries no entries. A heading ` +
        'with nothing under it is what a graduation produces when the range is ' +
        'empty, and it ships blank release notes.'
    );
  }
  return entries;
}

export interface ReleaseTreeInput {
  /** The tree to read, and the only one that is read. */
  tree: ReleaseTree;
  /** `parseReleaseTag(tag).version` — no `v`, `-rc.N` included when present. */
  version: string;
}

export interface ReleaseTreeResult {
  version: string;
  /** What was read, echoed so a summary line cannot claim the wrong tree. */
  source: string;
  /** Every governed manifest, verified. */
  manifests: string[];
  /** Entries found under the version's CHANGELOG heading. */
  entries: number;
}

export function checkReleaseTree(input: ReleaseTreeInput): ReleaseTreeResult {
  const { tree, version } = input;

  const manifests = governedManifests(tree);
  for (const manifest of manifests) {
    const declared = manifestVersion(tree, manifest);
    if (declared !== version) {
      throw new ReleaseTreeError(
        `${manifest} declares version ${declared}, but the tag names ${version}. ` +
          'Every governed manifest must carry the released version — run ' +
          '`pnpm release:prepare <tag>`, never bump by hand.'
      );
    }
  }

  const paths = tree.paths;
  if (!paths.has(CHANGELOG)) {
    throw new ReleaseTreeError(`${CHANGELOG} is not in ${tree.describe}.`);
  }
  const entries = changelogSection(tree.read(CHANGELOG), version);

  return { version, source: tree.describe, manifests, entries };
}

/**
 * A flag's value, or `undefined` when the flag is absent. "Present but empty"
 * is not a third state: `--rev ""` and `--rev --repo x` are both a flag whose
 * value was not supplied, and both reject here rather than reaching a checker
 * that would have to re-ask the question in its own words.
 */
function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return undefined;

  const value = process.argv[i + 1];
  if (value === undefined || value.startsWith('--') || value.trim() === '') {
    throw new ReleaseTreeError(`--${name} requires a value.`);
  }
  return value;
}

function required(name: string): string {
  const value = flag(name);
  if (value === undefined) {
    throw new ReleaseTreeError(`--${name} is required.`);
  }
  return value;
}

/**
 * The tag arrives as an explicit flag, never from `GITHUB_REF_NAME` behind the
 * caller's back — same reason the provenance gate insists on it. Which tree to
 * read is an explicit choice too: exactly one of `--rev` and `--worktree`, so
 * "no tree named" can never quietly mean "whatever is checked out".
 */
function main(): void {
  const tag = required('tag');
  const rev = flag('rev');
  const worktree = process.argv.includes('--worktree');

  if (rev !== undefined && worktree) {
    throw new ReleaseTreeError(
      '--rev and --worktree name two different trees. Pass exactly one.'
    );
  }
  if (rev === undefined && !worktree) {
    throw new ReleaseTreeError(
      'No tree named. Pass --rev <revision> to read a committed tree, or ' +
        '--worktree to read the tracked working tree.'
    );
  }
  const parsed = parseReleaseTag(tag);
  if (parsed === null) {
    throw new ReleaseTreeError(
      `"${tag}" is not a release tag. Supported shapes: vX.Y.Z and vX.Y.Z-rc.N.`
    );
  }

  const repo = flag('repo') ?? process.cwd();
  const result = checkReleaseTree({
    tree: rev === undefined ? worktreeTree(repo) : revTree(repo, rev),
    version: parsed.version,
  });

  console.log(
    `[release-tree] ok — ${tag} is claimed by ${result.source}: ` +
      `${result.manifests.length} manifests at ${result.version}, ` +
      `CHANGELOG section with ${result.entries} ` +
      `${result.entries === 1 ? 'entry' : 'entries'}.`
  );
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // A git or filesystem failure is a rejection too, and its stderr is the
    // only place that says what actually went wrong.
    const stderr = (err as { stderr?: unknown }).stderr;
    const detail =
      typeof stderr === 'string' && stderr.trim() !== ''
        ? `\n${stderr.trim()}`
        : '';
    console.error(`[release-tree] REJECTED — ${message}${detail}`);
    process.exit(1);
  }
}
