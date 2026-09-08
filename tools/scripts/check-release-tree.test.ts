/**
 * Behavioral proof for `check-release-tree.ts`.
 *
 * The checker refuses to publish a tree that does not claim its own tag, so
 * "it has always been green" is not evidence it refuses anything. Each case
 * materializes a throwaway repository with a real workspace shape — root
 * manifest, `apps/*` and `packages/*` members, a nested manifest that is *not*
 * a member, a CHANGELOG with a footer — and asserts the verdict.
 *
 * Both directions carry the same weight. A gate that rejects a legitimate
 * release is discovered with the tag already pushed, so every accepting case is
 * asserted as deliberately as every rejecting one.
 *
 * The last suite runs the checker against this repository at HEAD. That is the
 * liveness half: the real `[2.0.0]` hand-curated rollup, the real footer and the
 * real workspace must all be accepted, at every commit, before and after a bump.
 *
 * Run: `pnpm test:tools`
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';

import {
  ReleaseTreeError,
  changelogSection,
  checkReleaseTree,
  revTree,
  worktreeTree,
} from './check-release-tree';
import { REPO_ROOT } from './lib/report';

const created: string[] = [];

after(() => {
  for (const dir of created) rmSync(dir, { recursive: true, force: true });
});

/**
 * Identity and signing settings travel in the environment rather than in five
 * `git config` calls per fixture. Two reasons, and the second is the important
 * one:
 *
 * - it removes 5 of the 8 subprocesses each fixture used to spawn — 260 of the
 *   suite's 757 git invocations, worth ~8s of its wall time;
 * - env beats repository-local config, so a developer's global
 *   `commit.gpgsign = true` cannot reach these throwaway repositories by any
 *   route. This suite runs inside `.husky/pre-push`, where a pinentry prompt
 *   becomes a push that never completes, reported as a test failure pointing at
 *   the wrong thing.
 *
 * `core.autocrlf=false` is here so the CRLF fixture survives `git add`
 * byte-identical.
 */
const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'gate',
  GIT_AUTHOR_EMAIL: 'gate@test.local',
  GIT_COMMITTER_NAME: 'gate',
  GIT_COMMITTER_EMAIL: 'gate@test.local',
  GIT_CONFIG_COUNT: '3',
  GIT_CONFIG_KEY_0: 'commit.gpgsign',
  GIT_CONFIG_VALUE_0: 'false',
  GIT_CONFIG_KEY_1: 'tag.gpgsign',
  GIT_CONFIG_VALUE_1: 'false',
  GIT_CONFIG_KEY_2: 'core.autocrlf',
  GIT_CONFIG_VALUE_2: 'false',
};

function git(repo: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd: repo,
    encoding: 'utf-8',
    env: GIT_ENV,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

const DEFAULT_WORKSPACE = 'packages:\n  - apps/*\n  - packages/*\n';

/**
 * A workspace manifest as the repository now writes them: a name, no version.
 * The checker no longer reads these — they stay in the fixtures because a
 * release tree really does contain them, and a tree the tests build should look
 * like one.
 */
function manifest(name: string): string {
  return `${JSON.stringify({ name, private: true }, null, 2)}\n`;
}

/**
 * A CHANGELOG with the shape the real one has: a dated heading, a group, an
 * older section underneath, and a `---` rule before a footer that carries
 * bullets of its own. The footer is the fixture that catches a section
 * terminator which only looks for `## [`.
 */
function changelog(version: string): string {
  return [
    '# Changelog',
    '',
    `## [${version}] - 2026-09-06`,
    '',
    '### Added',
    '',
    '- **api**: the thing this release adds',
    '',
    '## [1.9.0] - 2026-06-26',
    '',
    '### Fixed',
    '',
    '- **web**: an older thing',
    '',
    '---',
    '',
    '## Pre-1.9.0 history',
    '',
    '- **calendar**: history that belongs to no release section',
    '',
  ].join('\n');
}

interface TreeSpec {
  /** Version written into every governed manifest unless overridden. */
  version: string;
  /** Raw content per path, replacing whatever the default fixture holds. */
  overrides?: Record<string, string>;
  /** Paths to leave out of the tree entirely. */
  omit?: string[];
  /** Extra paths to add. */
  extra?: Record<string, string>;
  /** Line endings. `crlf` proves the parsers are not LF-only. */
  eol?: 'lf' | 'crlf';
}

function files(spec: TreeSpec): Record<string, string> {
  const v = spec.version;
  const base: Record<string, string> = {
    'pnpm-workspace.yaml': DEFAULT_WORKSPACE,
    'CHANGELOG.md': changelog(v),
    'package.json': manifest('@luke/monorepo'),
    'apps/api/package.json': manifest('@luke/api'),
    'apps/web/package.json': manifest('@luke/web'),
    'packages/core/package.json': manifest('@luke/core'),
    'README.md': '# fixture\n',
  };

  for (const [path, content] of Object.entries(spec.extra ?? {}))
    base[path] = content;
  for (const [path, content] of Object.entries(spec.overrides ?? {}))
    base[path] = content;
  for (const path of spec.omit ?? []) delete base[path];

  if (spec.eol === 'crlf') {
    for (const path of Object.keys(base))
      base[path] = base[path].replace(/\n/g, '\r\n');
  }
  return base;
}

function writeAll(repo: string, contents: Record<string, string>): void {
  for (const [path, content] of Object.entries(contents)) {
    const full = join(repo, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
}

/** A repository holding one commit of `spec`. Settings come from `GIT_ENV`. */
function repoWith(spec: TreeSpec): string {
  const repo = mkdtempSync(join(tmpdir(), 'luke-release-tree-'));
  created.push(repo);

  git(repo, 'init', '-q', '-b', 'main');
  writeAll(repo, files(spec));
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'chore: release fixture');
  return repo;
}

/** Replace the working tree with a different spec, without committing it. */
function rewriteWorktree(repo: string, spec: TreeSpec): void {
  writeAll(repo, files(spec));
}

/** `assert.throws` predicate: a gate rejection whose reason matches. */
function reason(re: RegExp) {
  return (err: unknown) =>
    err instanceof ReleaseTreeError && re.test(err.message);
}

function checkRev(repo: string, version: string, rev = 'HEAD'): number {
  return checkReleaseTree({ tree: revTree(repo, rev), version }).entries;
}

function rejectsRev(
  repo: string,
  version: string,
  rev = 'HEAD'
): ReleaseTreeError {
  let thrown: unknown;
  try {
    checkRev(repo, version, rev);
  } catch (err) {
    thrown = err;
  }
  assert.ok(
    thrown instanceof ReleaseTreeError,
    `expected ${version} to be rejected in ${rev}, got ${String(thrown)}`
  );
  return thrown;
}

// ── Accepting: the shapes a real release has ─────────────────────────────────

test('a stable tag whose committed tree claims it is accepted', () => {
  const repo = repoWith({ version: '2.2.0' });
  assert.equal(checkRev(repo, '2.2.0'), 1);
});

test('an rc tag whose committed tree claims it is accepted', () => {
  const repo = repoWith({ version: '2.2.0-rc.1' });
  assert.equal(checkRev(repo, '2.2.0-rc.1'), 1);
});

test('a heading with no date is accepted, exactly like a dated one', () => {
  const repo = repoWith({
    version: '2.2.0',
    overrides: {
      'CHANGELOG.md': '# Changelog\n\n## [2.2.0]\n\n- **api**: a thing\n',
    },
  });
  assert.equal(checkRev(repo, '2.2.0'), 1);
});

test('a CRLF tree is read the same as an LF one', () => {
  const repo = repoWith({ version: '2.2.0', eol: 'crlf' });
  assert.equal(checkRev(repo, '2.2.0'), 1);
});

test('an annotated tag object resolves to the tree it points at', () => {
  const repo = repoWith({ version: '2.2.0-rc.3' });
  git(repo, 'tag', '-a', 'v2.2.0-rc.3', '-m', 'candidate');
  const tagObject = git(repo, 'rev-parse', 'refs/tags/v2.2.0-rc.3');

  assert.notEqual(
    tagObject,
    git(repo, 'rev-parse', 'HEAD'),
    'fixture must be annotated'
  );
  assert.equal(checkRev(repo, '2.2.0-rc.3', tagObject), 1);
  assert.equal(checkRev(repo, '2.2.0-rc.3', 'v2.2.0-rc.3'), 1);
});

test('a lightweight tag and a raw commit SHA both resolve', () => {
  const repo = repoWith({ version: '2.2.0' });
  git(repo, 'tag', 'v2.2.0');

  assert.equal(checkRev(repo, '2.2.0', 'v2.2.0'), 1);
  assert.equal(checkRev(repo, '2.2.0', git(repo, 'rev-parse', 'HEAD')), 1);
});

test('a second tag on the same commit does not change the explicit tag verdict', () => {
  // `git describe` answered with whichever tag it preferred, which is how the
  // old check failed a correct tree. The version comes from `--tag` and from
  // nothing else, so a stray sibling tag is invisible here.
  const repo = repoWith({ version: '2.2.0-rc.1' });
  git(repo, 'tag', 'v2.2.0-rc.1');
  git(repo, 'tag', 'v2.2.0');

  assert.equal(checkRev(repo, '2.2.0-rc.1', 'v2.2.0-rc.1'), 1);
  rejectsRev(repo, '2.2.0', 'v2.2.0');
});

test('an uncommitted bump is accepted in --worktree mode', () => {
  // Exactly release-prepare's state: git-cliff has written the section, nothing
  // is committed, no tag exists.
  const repo = repoWith({ version: '2.1.4' });
  rewriteWorktree(repo, { version: '2.2.0-rc.1' });

  assert.equal(
    checkReleaseTree({ tree: worktreeTree(repo), version: '2.2.0-rc.1' })
      .entries,
    1
  );
});

// ── Rejecting: CHANGELOG ─────────────────────────────────────────────────────

test('a missing CHANGELOG is rejected', () => {
  const repo = repoWith({ version: '2.2.0', omit: ['CHANGELOG.md'] });
  assert.match(rejectsRev(repo, '2.2.0').message, /CHANGELOG\.md is not in/);
});

test('a missing heading is rejected', () => {
  const repo = repoWith({
    version: '2.2.0',
    overrides: { 'CHANGELOG.md': changelog('2.1.9') },
  });
  assert.match(
    rejectsRev(repo, '2.2.0').message,
    /has no "## \[2\.2\.0\]" heading/
  );
});

test('a heading with an empty section is rejected', () => {
  const repo = repoWith({
    version: '2.2.0',
    overrides: {
      'CHANGELOG.md':
        '# Changelog\n\n## [2.2.0] - 2026-09-06\n\n## [2.1.4] - 2026-09-02\n\n- old\n',
    },
  });
  assert.match(rejectsRev(repo, '2.2.0').message, /carries no entries/);
});

test('a group heading with no entry under it is rejected', () => {
  const repo = repoWith({
    version: '2.2.0',
    overrides: {
      'CHANGELOG.md':
        '# Changelog\n\n## [2.2.0]\n\n### Added\n\n## [2.1.4]\n\n- old\n',
    },
  });
  assert.match(rejectsRev(repo, '2.2.0').message, /carries no entries/);
});

test('git-cliff output for an empty range — heading, blank, rule — is rejected', () => {
  // The graduation bug in its exact shape: `--unreleased` starts at the final
  // rc, finds nothing, and emits a heading with a horizontal rule under it.
  const repo = repoWith({
    version: '2.2.0',
    overrides: {
      'CHANGELOG.md':
        '# Changelog\n\n## [2.2.0] - 2026-09-06\n\n---\n\n- footer bullet\n',
    },
  });
  assert.match(rejectsRev(repo, '2.2.0').message, /carries no entries/);
});

test('entries belonging to the adjacent section cannot satisfy the heading', () => {
  const repo = repoWith({
    version: '2.2.0',
    overrides: {
      'CHANGELOG.md':
        '# Changelog\n\n## [2.2.0]\n\n## [2.1.4]\n\n- **api**: not this release\n',
    },
  });
  assert.match(rejectsRev(repo, '2.2.0').message, /carries no entries/);
});

test('bullets in the historical footer after --- cannot satisfy the heading', () => {
  const repo = repoWith({
    version: '2.2.0',
    overrides: {
      'CHANGELOG.md':
        '# Changelog\n\n## [2.2.0]\n\n---\n\n## Pre-1.9.0 history\n\n- history\n',
    },
  });
  assert.match(rejectsRev(repo, '2.2.0').message, /carries no entries/);
});

test('duplicate matching headings are rejected in both orders', () => {
  const empty = '## [2.2.0] - 2026-09-06\n\n';
  const full = '## [2.2.0] - 2026-09-05\n\n- **api**: a thing\n\n';

  for (const [first, second] of [
    [empty, full],
    [full, empty],
  ]) {
    const repo = repoWith({
      version: '2.2.0',
      overrides: { 'CHANGELOG.md': `# Changelog\n\n${first}${second}` },
    });
    assert.match(
      rejectsRev(repo, '2.2.0').message,
      /has 2 "## \[2\.2\.0\]" headings/
    );
  }
});

test('a stable tag is not satisfied by rc sections, nor an rc by the stable one', () => {
  // A candidate's notes do not answer for the stable release, in either
  // direction. The closing bracket in the heading prefix is what keeps
  // `[2.2.0]` from matching `[2.2.0-rc.1]`.
  const rcOnly = repoWith({ version: '2.2.0-rc.1' });
  assert.match(
    rejectsRev(rcOnly, '2.2.0').message,
    /has no "## \[2\.2\.0\]"/
  );

  const stableNotes = repoWith({
    version: '2.2.0-rc.1',
    overrides: { 'CHANGELOG.md': changelog('2.2.0') },
  });
  assert.match(
    rejectsRev(stableNotes, '2.2.0-rc.1').message,
    /has no "## \[2\.2\.0-rc\.1\]"/
  );
});

test('an rc.10 heading does not satisfy an rc.1 tag', () => {
  const repo = repoWith({
    version: '2.2.0-rc.1',
    overrides: { 'CHANGELOG.md': changelog('2.2.0-rc.10') },
  });
  assert.match(
    rejectsRev(repo, '2.2.0-rc.1').message,
    /has no "## \[2\.2\.0-rc\.1\]"/
  );
});

test('a heading with a malformed suffix is named, not ignored', () => {
  for (const heading of [
    '## [2.2.0] - not-a-date',
    '## [2.2.0] (2026-09-06)',
    '## [2.2.0]:',
    '## [2.2.0] - 2026-9-6',
  ]) {
    const repo = repoWith({
      version: '2.2.0',
      overrides: {
        'CHANGELOG.md': `# Changelog\n\n${heading}\n\n- **api**: a thing\n`,
      },
    });
    assert.match(
      rejectsRev(repo, '2.2.0').message,
      /is a malformed heading for 2\.2\.0/,
      `expected ${heading} to be named as malformed`
    );
  }
});

test('any [Unreleased] heading refuses the whole tree', () => {
  // git-cliff writes it whenever `changelog:bump` runs without `--tag`; a later
  // release:prepare prepends a versioned heading above it and the same entries
  // ship twice.
  const repo = repoWith({
    version: '2.2.0',
    overrides: {
      'CHANGELOG.md':
        '# Changelog\n\n## [2.2.0] - 2026-09-06\n\n- **api**: a thing\n\n' +
        '## [Unreleased]\n\n- **api**: the same thing\n',
    },
  });
  assert.match(
    rejectsRev(repo, '2.2.0').message,
    /still carries an "## \[Unreleased\]" heading/
  );
});

test('every form of an Unreleased heading is rejected, and only headings are', () => {
  // git-cliff writes the bare form. The rule is on the heading's *start*, so a
  // dated or annotated variant is the same section, and the case of the word
  // does not turn it into a different one. On the pure function, so each line
  // is judged on its own.
  const entry = '\n\n- **api**: a thing\n';
  const section = `# Changelog\n\n## [2.2.0] - 2026-09-06${entry}\n`;

  for (const heading of [
    '## [Unreleased]',
    '## [Unreleased] - 2026-09-07',
    '## [Unreleased] (pending)',
    '## [unreleased]',
    '## [UNRELEASED]',
    '##  [Unreleased]',
    '##\t[Unreleased]',
  ]) {
    assert.throws(
      () => changelogSection(`${section}${heading}${entry}`, '2.2.0'),
      reason(/still carries an "## \[Unreleased\]" heading/),
      `expected ${JSON.stringify(heading)} to be rejected`
    );
  }

  // Not that section: a level-three group heading, prose that mentions the
  // string, a bracketed word that is not `Unreleased`, and a level-two heading
  // without the bracketed form. None may be misclassified.
  for (const line of [
    '### [Unreleased]',
    'Nothing here is ## [Unreleased]; the heading is above.',
    'See [Unreleased] in the old notes.',
    '## [Unrelated]',
    '## Unreleased notes were never a section here',
  ]) {
    assert.equal(
      changelogSection(`${section}${line}\n`, '2.2.0'),
      1,
      `expected ${JSON.stringify(line)} to be left alone`
    );
  }
});

test('changelogSection isolates the heading by literal prefix, then validates it anchored', () => {
  // Two guards, in order. The literal `## [<version>]` prefix decides which
  // lines are this version's heading at all: `## [2x2.0]` and `## [2.2.0-rc.1]`
  // never reach the pattern for 2.2.0, so neither can answer for it. The
  // anchored pattern then decides whether a line that *is* this version's
  // heading is well formed (the malformed-suffix test above).
  //
  // Deliberately not a proof of `escapeRegExp`: the prefix guard runs first, so
  // heading-side escaping is unobservable here. Where escaping is load-bearing
  // is the workspace-glob pattern, and the `apps.x/*` test proves it there —
  // dropping `escapeRegExp` turns that test red, not this one.
  assert.throws(
    () => changelogSection('# C\n\n## [2x2.0]\n\n- entry\n', '2.2.0'),
    reason(/has no "## \[2\.2\.0\]"/)
  );
  assert.throws(
    () => changelogSection('# C\n\n## [2.2.0-rc.1]\n\n- entry\n', '2.2.0'),
    reason(/has no "## \[2\.2\.0\]"/)
  );
  assert.equal(changelogSection('# C\n\n## [2.2.0]\n\n- a\n- b\n', '2.2.0'), 2);
});

// ── The tree that is read, and the tree that is not ──────────────────────────

test('--rev reads the named tree and never the working tree', () => {
  // The A5 lab in one assertion: the committed tree is correct for the tag, the
  // working tree has moved on to another version. A checker that read the
  // worktree would reject a legitimate push.
  const repo = repoWith({ version: '2.2.0-rc.1' });
  rewriteWorktree(repo, { version: '2.3.0-rc.1' });

  assert.equal(checkRev(repo, '2.2.0-rc.1'), 1);
  assert.throws(
    () => checkReleaseTree({ tree: worktreeTree(repo), version: '2.2.0-rc.1' }),
    ReleaseTreeError
  );
});

test('--rev rejects a committed tree even when the working tree would pass', () => {
  const repo = repoWith({ version: '2.1.4' });
  rewriteWorktree(repo, { version: '2.2.0' });

  rejectsRev(repo, '2.2.0');
  assert.equal(
    checkReleaseTree({ tree: worktreeTree(repo), version: '2.2.0' }).entries,
    1
  );
});

test('an unresolvable revision is rejected rather than falling back', () => {
  const repo = repoWith({ version: '2.2.0' });

  for (const rev of [
    'v9.9.9',
    'refs/tags/nope',
    '0000000000000000000000000000000000000000',
  ]) {
    assert.throws(
      () => revTree(repo, rev),
      reason(/does not resolve to a tree/),
      `expected ${rev} to be refused`
    );
  }
});

test('a revision that would be read as a git option is refused', () => {
  const repo = repoWith({ version: '2.2.0' });
  assert.throws(() => revTree(repo, '--all'), reason(/leading "-"/));
});

// ── CLI contract ─────────────────────────────────────────────────────────────

interface Run {
  status: number;
  stdout: string;
  stderr: string;
}

/**
 * `execFileSync` throws on a non-zero exit and hangs the status, stdout and
 * stderr off the thrown error, so both outcomes have to be read from one place
 * — the exit code is half of what this CLI promises.
 */
function runCli(repo: string, args: string[]): Run {
  try {
    const stdout = execFileSync(
      process.execPath,
      [
        '--import',
        'tsx',
        join(__dirname, 'check-release-tree.ts'),
        '--repo',
        repo,
        ...args,
      ],
      { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }
    );
    return { status: 0, stdout, stderr: '' };
  } catch (err) {
    // The Node types model the extra fields on the thrown Error as absent, so
    // the shape has to be stated to read the exit status the test asserts on.
    const failure = err as {
      status?: number;
      stdout?: string;
      stderr?: string;
    };
    return {
      status: failure.status ?? -1,
      stdout: failure.stdout ?? '',
      stderr: failure.stderr ?? '',
    };
  }
}

test('the CLI exits 0 with one ok line for a tree that claims its tag', () => {
  const repo = repoWith({ version: '2.2.0-rc.1' });
  git(repo, 'tag', 'v2.2.0-rc.1');

  const run = runCli(repo, ['--tag', 'v2.2.0-rc.1', '--rev', 'v2.2.0-rc.1']);
  assert.equal(run.status, 0);
  assert.match(
    run.stdout,
    /^\[release-tree\] ok — v2\.2\.0-rc\.1 is claimed by/
  );
  assert.match(
    run.stdout,
    /CHANGELOG section for 2\.2\.0-rc\.1 with 1 entry\./
  );
  assert.equal(run.stdout.trimEnd().split('\n').length, 1);
});

test('the CLI exits 1 with a REJECTED reason for a tree that does not', () => {
  // The tree ships notes for another version: the one thing a release tree can
  // still get wrong about the tag that publishes it.
  const repo = repoWith({
    version: '2.2.0',
    overrides: { 'CHANGELOG.md': changelog('2.1.4') },
  });
  git(repo, 'tag', 'v2.2.0');

  const run = runCli(repo, ['--tag', 'v2.2.0', '--rev', 'v2.2.0']);
  assert.equal(run.status, 1);
  assert.match(
    run.stderr,
    /^\[release-tree\] REJECTED — CHANGELOG\.md has no "## \[2\.2\.0\]"/
  );
});

test('the CLI refuses every malformed invocation', () => {
  const repo = repoWith({ version: '2.2.0' });
  git(repo, 'tag', 'v2.2.0');

  const cases: Array<[string[], RegExp]> = [
    [[], /--tag is required/],
    [['--tag', 'v2.2.0'], /No tree named/],
    [
      ['--tag', 'v2.2.0', '--rev', 'HEAD', '--worktree'],
      /name two different trees/,
    ],
    [['--rev', 'HEAD'], /--tag is required/],
    [['--tag', '--rev'], /--tag requires a value/],
    [['--tag', 'v2.2.0', '--rev'], /--rev requires a value/],
    [['--tag', 'v2.2', '--rev', 'HEAD'], /is not a release tag/],
    [['--tag', 'v2.2.0-rc1', '--rev', 'HEAD'], /is not a release tag/],
    [['--tag', 'v2.2.0-rc.0', '--rev', 'HEAD'], /is not a release tag/],
    // A tag is data. A metacharacter cannot reach a pattern because the shape
    // parser refuses it first.
    [['--tag', 'v2.2.0.*', '--rev', 'HEAD'], /is not a release tag/],
    [['--tag', 'v2.2.0', '--rev', 'v9.9.9'], /does not resolve to a tree/],
  ];

  for (const [args, expected] of cases) {
    const run = runCli(repo, args);
    assert.equal(run.status, 1, `expected ${JSON.stringify(args)} to exit 1`);
    assert.match(run.stderr, /^\[release-tree\] REJECTED — /);
    assert.match(
      run.stderr,
      expected,
      `wrong reason for ${JSON.stringify(args)}`
    );
  }
});

test('the CLI accepts --worktree for a bump that exists in no commit', () => {
  const repo = repoWith({ version: '2.1.4' });
  rewriteWorktree(repo, { version: '2.2.0-rc.1' });

  const run = runCli(repo, ['--tag', 'v2.2.0-rc.1', '--worktree']);
  assert.equal(run.status, 0);
  assert.match(run.stdout, /is claimed by the working tree/);
});

test('the CLI in --rev mode ignores a divergent working tree', () => {
  // The mode selection lives in `main()`, which the direct-call tests above
  // never enter — so without this, a CLI that quietly read the worktree in both
  // modes would leave them all green. The same repository must answer
  // differently for the two flags, which is only possible if they read two
  // different trees.
  const repo = repoWith({ version: '2.2.0-rc.1' });
  git(repo, 'tag', 'v2.2.0-rc.1');
  // The worktree has moved on to the next candidate's notes, which is exactly
  // what preparing a release does before anything is committed or tagged.
  rewriteWorktree(repo, { version: '2.3.0-rc.1' });

  const rev = runCli(repo, ['--tag', 'v2.2.0-rc.1', '--rev', 'v2.2.0-rc.1']);
  assert.equal(rev.status, 0, rev.stderr);
  assert.match(
    rev.stdout,
    /CHANGELOG section for 2\.2\.0-rc\.1 with 1 entry\./
  );

  const wt = runCli(repo, ['--tag', 'v2.2.0-rc.1', '--worktree']);
  assert.equal(wt.status, 1);
  assert.match(wt.stderr, /has no "## \[2\.2\.0-rc\.1\]"/);
});

test('a tracked file deleted from the working tree is rejected, not skipped', () => {
  const repo = repoWith({ version: '2.2.0' });
  // CHANGELOG.md, because it is now the only file the checker reads: a tracked
  // path that git lists but the filesystem no longer has must be an error, not
  // a silently skipped check.
  unlinkSync(join(repo, 'CHANGELOG.md'));

  const run = runCli(repo, ['--tag', 'v2.2.0', '--worktree']);
  assert.equal(run.status, 1);
  assert.match(run.stderr, /tracked but absent from the working tree/);
});

// ── Liveness: this repository, at HEAD ───────────────────────────────────────

/**
 * The fixtures above prove the contract; this proves the contract admits the
 * real repository. The hand-curated `[2.0.0]` rollup and the `---` before the
 * `## Pre-1.9.0 history` footer both have to pass — at every commit, including
 * one that has just prepared a release whose tag does not exist yet.
 *
 * The version is read from the tree rather than written here: a test pinned to
 * a release number goes red on the next release, which teaches everyone to
 * update the assertion instead of reading it. Its source used to be the root
 * manifest; no manifest declares a version any more, so the newest section of
 * `CHANGELOG.md` is what the tree says about itself.
 */
test('this repository at HEAD claims the newest version its CHANGELOG declares', () => {
  const tree = revTree(REPO_ROOT, 'HEAD');
  const heading = /^## \[(\d+\.\d+\.\d+(?:-rc\.\d+)?)\]/m.exec(
    tree.read('CHANGELOG.md')
  );
  if (heading === null) {
    throw new Error(
      'CHANGELOG.md at HEAD carries no `## [X.Y.Z]` heading, so this tree ' +
        'claims no version at all.'
    );
  }
  const version = heading[1];

  let result;
  try {
    result = checkReleaseTree({ tree, version });
  } catch (err) {
    // This runs on every push, not only a tag push, so its failure has to say
    // what to do about a repository that is not release-consistent — otherwise
    // it blocks every push with a message about release tags and no obvious
    // remedy.
    throw new Error(
      `HEAD does not claim ${version}, the newest version its CHANGELOG.md ` +
        `declares.\n  ${err instanceof Error ? err.message : String(err)}\n` +
        '  A hand-edited CHANGELOG.md, a duplicated heading, or a stray ' +
        '`## [Unreleased]` from `changelog:bump`? Restore it.\n' +
        '  This is the same check release.yml runs on a tagged tree, so a red ' +
        'here is a release that would be refused.',
      { cause: err }
    );
  }

  assert.equal(result.version, version);
  assert.ok(result.entries >= 1);
});
