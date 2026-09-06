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
  governedManifests,
  parseWorkspaceGlobs,
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

function manifest(name: string, version: string): string {
  return `${JSON.stringify({ name, version, private: true }, null, 2)}\n`;
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
    'package.json': manifest('@luke/monorepo', v),
    'apps/api/package.json': manifest('@luke/api', v),
    'apps/web/package.json': manifest('@luke/web', v),
    'packages/core/package.json': manifest('@luke/core', v),
    // Not a workspace member: `apps/*` is a direct-child glob, so a manifest
    // one level deeper is vendored code the release does not govern.
    'apps/web/vendor/thing/package.json': manifest('vendored', '0.0.1'),
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

test('a manifest nested below a workspace member is ignored, not governed', () => {
  // `apps/web/vendor/thing/package.json` sits at 0.0.1 in every fixture. If the
  // glob were read as "anything under apps/", every case above would fail.
  const repo = repoWith({ version: '2.2.0' });
  const manifests = governedManifests(revTree(repo, 'HEAD'));

  assert.deepEqual(manifests, [
    'apps/api/package.json',
    'apps/web/package.json',
    'package.json',
    'packages/core/package.json',
  ]);
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
  // Exactly release-prepare's state: git-cliff and sync-version have written,
  // nothing is committed, no tag exists.
  const repo = repoWith({ version: '2.1.4' });
  rewriteWorktree(repo, { version: '2.2.0-rc.1' });

  assert.equal(
    checkReleaseTree({ tree: worktreeTree(repo), version: '2.2.0-rc.1' })
      .entries,
    1
  );
});

// ── Rejecting: manifests ─────────────────────────────────────────────────────

test('one workspace manifest off by a prerelease counter is rejected', () => {
  const repo = repoWith({
    version: '2.2.0-rc.2',
    overrides: { 'apps/web/package.json': manifest('@luke/web', '2.2.0-rc.1') },
  });
  assert.match(
    rejectsRev(repo, '2.2.0-rc.2').message,
    /apps\/web\/package\.json declares version/
  );
});

test('the root manifest alone being off is rejected', () => {
  const repo = repoWith({
    version: '2.2.0',
    overrides: { 'package.json': manifest('@luke/monorepo', '2.1.4') },
  });
  assert.match(
    rejectsRev(repo, '2.2.0').message,
    /^package\.json declares version 2\.1\.4/
  );
});

test('a manifest version carrying the leading v is rejected', () => {
  const repo = repoWith({
    version: '2.2.0',
    overrides: {
      'packages/core/package.json': manifest('@luke/core', 'v2.2.0'),
    },
  });
  assert.match(rejectsRev(repo, '2.2.0').message, /declares version v2\.2\.0/);
});

test('a manifest with no version field is rejected', () => {
  const repo = repoWith({
    version: '2.2.0',
    overrides: { 'apps/api/package.json': '{\n  "name": "@luke/api"\n}\n' },
  });
  assert.match(rejectsRev(repo, '2.2.0').message, /declares no `version`/);
});

test('a manifest whose version is not a string is rejected', () => {
  const repo = repoWith({
    version: '2.2.0',
    overrides: {
      'apps/api/package.json':
        '{\n  "name": "@luke/api",\n  "version": null\n}\n',
    },
  });
  assert.match(rejectsRev(repo, '2.2.0').message, /is not a\s+version string/);
});

test('an unparsable manifest is rejected, not skipped', () => {
  const repo = repoWith({
    version: '2.2.0',
    overrides: {
      'apps/api/package.json': '{ "name": "@luke/api", "version": }\n',
    },
  });
  assert.match(rejectsRev(repo, '2.2.0').message, /is not valid JSON/);
});

test('a missing root manifest is rejected', () => {
  const repo = repoWith({ version: '2.2.0', omit: ['package.json'] });
  assert.match(rejectsRev(repo, '2.2.0').message, /package\.json is not in/);
});

// ── Rejecting: workspace declaration ─────────────────────────────────────────

test('a configured glob discovering zero manifests is rejected', () => {
  const repo = repoWith({
    version: '2.2.0',
    overrides: {
      'pnpm-workspace.yaml': 'packages:\n  - apps/*\n  - services/*\n',
    },
  });
  assert.match(
    rejectsRev(repo, '2.2.0').message,
    /"services\/\*" discovers no package\.json/
  );
});

test('an unsupported glob shape is rejected rather than guessed at', () => {
  for (const glob of [
    'apps/**',
    '**',
    'apps',
    '!apps/*',
    'apps/*/*',
    '/apps/*',
    // A glob may not reach outside the repository. These discover nothing
    // either way, but they must be refused for the right reason.
    '../*',
    './*',
  ]) {
    const repo = repoWith({
      version: '2.2.0',
      overrides: { 'pnpm-workspace.yaml': `packages:\n  - ${glob}\n` },
    });
    assert.match(
      rejectsRev(repo, '2.2.0').message,
      /not a direct-child glob/,
      `expected ${glob} to be refused as an unsupported shape`
    );
  }
});

test('a glob is escaped before it becomes a pattern, so `.` is a dot', () => {
  // `DIRECT_CHILD_GLOB` admits a dot in the prefix, and an unescaped `apps.x/*`
  // is the pattern `apps` + any + `x`, which also governs `appsXx/`. The
  // fixture separates the two: only the literal directory is at the released
  // version, so escaping is the difference between accepting and rejecting.
  const repo = repoWith({
    version: '2.2.0',
    overrides: { 'pnpm-workspace.yaml': 'packages:\n  - apps.x/*\n' },
    extra: {
      'apps.x/web/package.json': manifest('@luke/web', '2.2.0'),
      'appsXx/web/package.json': manifest('vendored', '9.9.9'),
    },
  });

  assert.deepEqual(governedManifests(revTree(repo, 'HEAD')), [
    'apps.x/web/package.json',
    'package.json',
  ]);
  assert.equal(checkRev(repo, '2.2.0'), 1);
});

test('a missing workspace file is rejected', () => {
  const repo = repoWith({ version: '2.2.0', omit: ['pnpm-workspace.yaml'] });
  assert.match(
    rejectsRev(repo, '2.2.0').message,
    /pnpm-workspace\.yaml is not in/
  );
});

test('parseWorkspaceGlobs accepts the shapes the repository actually writes', () => {
  assert.deepEqual(parseWorkspaceGlobs(DEFAULT_WORKSPACE), [
    'apps/*',
    'packages/*',
  ]);
  assert.deepEqual(
    parseWorkspaceGlobs(
      'packages:\n  # a comment\n  - \'apps/*\'\n\n  - "packages/*"  # trailing\n'
    ),
    ['apps/*', 'packages/*']
  );
  // The sequence ends at the next top-level key, not at the end of the file.
  assert.deepEqual(
    parseWorkspaceGlobs(
      'packages:\n  - apps/*\n\nallowBuilds:\n  sharp: true\n'
    ),
    ['apps/*']
  );
  // A `packages:` further down that is *indented* is another key's value.
  assert.deepEqual(
    parseWorkspaceGlobs('packages:\n  - apps/*\n\nother:\n  packages: [x]\n'),
    ['apps/*']
  );
});

test('parseWorkspaceGlobs fails closed on everything it does not understand', () => {
  const cases: Array<[string, RegExp]> = [
    ['allowBuilds:\n  sharp: true\n', /declares no top-level `packages:` key/],
    ['packages:\n', /with no entries/],
    ['packages: [apps/*, packages/*]\n', /carries an inline value/],
    [
      'packages:\n  - apps/*\npackages:\n  - packages/*\n',
      /declares `packages:` 2 times/,
    ],
    ['packages:\n  - apps/*\n    - packages/*\n', /inconsistent indentation/],
    ['packages:\n  - apps/*\n  extra: true\n', /is not a `- <glob>` item/],
    ["packages:\n  - ''\n", /empty `packages:` entry/],
  ];

  for (const [yaml, expected] of cases) {
    assert.throws(
      () => parseWorkspaceGlobs(yaml),
      reason(expected),
      `expected ${JSON.stringify(yaml)} to be refused`
    );
  }
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
  const rcOnly = repoWith({ version: '2.2.0-rc.1' });
  assert.match(
    rejectsRev(rcOnly, '2.2.0').message,
    /declares version 2\.2\.0-rc\.1/
  );

  // Manifests aligned, CHANGELOG carrying the other spelling: isolates the
  // heading half from the manifest half.
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
  assert.match(run.stdout, /4 manifests at 2\.2\.0-rc\.1/);
  assert.match(run.stdout, /CHANGELOG section with 1 entry\./);
  assert.equal(run.stdout.trimEnd().split('\n').length, 1);
});

test('the CLI exits 1 with a REJECTED reason for a tree that does not', () => {
  const repo = repoWith({
    version: '2.2.0',
    overrides: { 'apps/web/package.json': manifest('@luke/web', '2.1.4') },
  });
  git(repo, 'tag', 'v2.2.0');

  const run = runCli(repo, ['--tag', 'v2.2.0', '--rev', 'v2.2.0']);
  assert.equal(run.status, 1);
  assert.match(
    run.stderr,
    /^\[release-tree\] REJECTED — apps\/web\/package\.json declares version/
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
  rewriteWorktree(repo, { version: '2.3.0-rc.1' });

  const rev = runCli(repo, ['--tag', 'v2.2.0-rc.1', '--rev', 'v2.2.0-rc.1']);
  assert.equal(rev.status, 0, rev.stderr);
  assert.match(rev.stdout, /4 manifests at 2\.2\.0-rc\.1/);

  const wt = runCli(repo, ['--tag', 'v2.2.0-rc.1', '--worktree']);
  assert.equal(wt.status, 1);
  assert.match(wt.stderr, /declares version 2\.3\.0-rc\.1/);
});

test('a tracked file deleted from the working tree is rejected, not skipped', () => {
  const repo = repoWith({ version: '2.2.0' });
  unlinkSync(join(repo, 'apps/web/package.json'));

  const run = runCli(repo, ['--tag', 'v2.2.0', '--worktree']);
  assert.equal(run.status, 1);
  assert.match(run.stderr, /tracked but absent from the working tree/);
});

// ── Liveness: this repository, at HEAD ───────────────────────────────────────

/**
 * The fixtures above prove the contract; this proves the contract admits the
 * real repository. The hand-curated `[2.0.0]` rollup, the `---` before the
 * `## Pre-1.9.0 history` footer and the eight real manifests all have to pass —
 * at every commit, including a bump commit whose tag does not exist yet.
 *
 * The version is read from the tree rather than written here: a test pinned to
 * a release number goes red on the next release, which teaches everyone to
 * update the assertion instead of reading it.
 */
test('this repository at HEAD claims the version its root manifest declares', () => {
  const tree = revTree(REPO_ROOT, 'HEAD');
  const root: unknown = JSON.parse(tree.read('package.json'));
  assert.ok(typeof root === 'object' && root !== null && 'version' in root);
  const version = root.version;
  if (typeof version !== 'string') {
    throw new Error('the root package.json at HEAD declares no version string');
  }

  let result;
  try {
    result = checkReleaseTree({ tree, version });
  } catch (err) {
    // This runs on every push, not only a tag push, so its failure has to say
    // what to do about a repository that is not release-consistent — otherwise
    // a new workspace package left at npm's default 1.0.0 blocks every push
    // with a message about release tags and no obvious remedy.
    throw new Error(
      `HEAD does not claim ${version}, the version its root package.json ` +
        `declares.\n  ${err instanceof Error ? err.message : String(err)}\n` +
        '  A new workspace package still at its default version? ' +
        `\`pnpm sync-version --set ${version}\`.\n` +
        '  A hand-edited CHANGELOG.md, or a stray `## [Unreleased]` from ' +
        '`changelog:bump`? Restore it.\n' +
        '  This is the same check release.yml runs on a tagged tree, so a red ' +
        'here is a release that would be refused.',
      { cause: err }
    );
  }

  assert.ok(
    result.manifests.length >= 2,
    'the workspace must govern more than the root'
  );
  assert.ok(result.entries >= 1);
});
