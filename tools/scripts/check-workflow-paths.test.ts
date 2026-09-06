/**
 * Behavioral proof for `check-workflow-paths.ts`.
 *
 * The allowlist under `ci.yml`'s `push.paths-ignore` decides when CI does not
 * run, so every invariant has a fixture that breaks exactly it and goes red,
 * next to the harmless variant that stays green. Fixtures are plain temp
 * directories: the tracked-file list is injected, and one case at the end
 * proves the default comes from `git ls-files`. The table near the end is the
 * contract at its most literal — which concrete paths skip CI, which do not,
 * and which of them the Docs workflow still observes.
 *
 * Run: `pnpm test:tools`
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';

import {
  CI_DOCUMENTATION_PATHS_IGNORE,
  DOCS_TRIGGER_PATHS,
  DOCS_TRIGGERS,
  WorkflowPathError,
  checkWorkflowPaths,
  matchesPathFilter,
} from './check-workflow-paths';
import { type Problem } from './lib/report';

const created: string[] = [];

after(() => {
  for (const dir of created) rmSync(dir, { recursive: true, force: true });
});

const SECURITY = `name: security

on:
  push:
    branches: [main, 'develop-*', 'release/*']
  schedule:
    - cron: '0 6 * * 1'

env:
  RELEASE_TRAIN_BRANCH: develop-2.2

jobs:
  gitleaks:
    runs-on: ubuntu-latest
`;

const RELEASE = `name: Release

on:
  push:
    tags:
      - 'v*'

env:
  STABLE_BRANCH: main
  RELEASE_TRAIN_BRANCH: develop-2.2

jobs:
  provenance:
    runs-on: ubuntu-latest
`;

const IGNORE_BLOCK = CI_DOCUMENTATION_PATHS_IGNORE.map(p => `      - '${p}'`).join('\n');

const CI = `name: CI

on:
  push:
    branches: [main, develop-2.2]
    # Documentation ownership surface.
    paths-ignore:
${IGNORE_BLOCK}
  pull_request:
    branches: [main, develop-2.2]
  # Reused by release.yml.
  workflow_call:

jobs:
  checks:
    name: Lint, TypeCheck & Unit Tests
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - name: Lint
        run: pnpm lint
  integration:
    name: Integration Tests
    runs-on: ubuntu-latest
  migrations:
    name: Migrations
    runs-on: ubuntu-latest
`;

const DOCS_STEPS = `    steps:
      - uses: actions/checkout@v7
      - uses: ./.github/actions/setup-workspace

      - name: Docs & skills drift
        run: pnpm check:drift
`;

const DOCS = `name: Docs

on:
  push:
    branches: [main, 'develop-*', 'release/*']
    paths: ['docs/**', '**.md']

jobs:
  drift:
    name: Documentation drift
    runs-on: ubuntu-latest
${DOCS_STEPS}`;

/** One tracked file per allowlist entry, plus neighbours that must not be ignored. */
const TRACKED = [
  'docs/README.md',
  'docs/decisions/001-first.md',
  'docs/plan.pdf',
  'README.md',
  'CLAUDE.md',
  'lessons.md',
  'lessons-archive.md',
  'API_SETUP.md',
  'APP_CONFIG.md',
  'OPERATIONS.md',
  'SETUP_STATUS.md',
  'INTEGRATIONS_ROADMAP.md',
  'apps/api/README.md',
  'packages/core/README.md',
  'tools/README.md',
  '.claude/skills/luke-audit/SKILL.md',
  '.claude/skills/luke-deps/references/policy.md',
  'CHANGELOG.md',
  'apps/api/SECURITY.md',
  'apps/api/src/index.ts',
  'package.json',
];

type Fixture = {
  security?: string;
  release?: string;
  ci?: string;
  /** `null` omits the file entirely. */
  docs?: string | null;
};

function workflowsDir(overrides: Fixture = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'luke-wfpaths-'));
  created.push(dir);
  const files: Record<string, string> = {
    'security.yml': overrides.security ?? SECURITY,
    'release.yml': overrides.release ?? RELEASE,
    'ci.yml': overrides.ci ?? CI,
  };
  if (overrides.docs !== null) files['docs.yml'] = overrides.docs ?? DOCS;
  mkdirSync(join(dir, '.github/workflows'), { recursive: true });
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, '.github/workflows', name), text);
  return dir;
}

function problems(overrides: Fixture = {}, tracked: readonly string[] = TRACKED): Problem[] {
  return checkWorkflowPaths(workflowsDir(overrides), tracked);
}

/** Exactly one problem, matching `re`. */
function only(overrides: Fixture, re: RegExp, tracked: readonly string[] = TRACKED): Problem {
  const found = problems(overrides, tracked);
  assert.equal(found.length, 1, JSON.stringify(found, null, 2));
  assert.match(found[0].message, re);
  return found[0];
}

function withExtra(entry: string): string {
  return CI.replace('    paths-ignore:\n', `    paths-ignore:\n      - '${entry}'\n`);
}

// ── The shape that is correct today stays green ──────────────────────────────

test('the current arrangement reports no problems', () => {
  assert.deepEqual(problems(), []);
});

test('reordering or requoting either list is harmless: neither has negations', () => {
  const reversed = [...CI_DOCUMENTATION_PATHS_IGNORE].reverse().map(p => `      - "${p}"`).join('\n');
  const docs = DOCS.replace("['docs/**', '**.md']", "['**.md', 'docs/**']");
  assert.deepEqual(problems({ ci: CI.replace(IGNORE_BLOCK, reversed), docs }), []);
});

// ── ci.yml: the allowlist and nothing but the allowlist ──────────────────────

test('a missing allowlist entry is reported', () => {
  const p = only({ ci: CI.replace("      - 'tools/README.md'\n", '') }, /missing `tools\/README\.md`/);
  assert.match(p.file, /ci\.yml$/);
});

test('widening is refused: release control, a directory-wide entry, a global Markdown entry', () => {
  for (const entry of ['CHANGELOG.md', 'docs/**', '**.md']) {
    only({ ci: withExtra(entry) }, /not part of the pinned contract/);
  }
});

test('a duplicated entry is reported', () => {
  only({ ci: withExtra('CLAUDE.md') }, /lists `CLAUDE\.md` twice/);
});

test('removing the whole paths-ignore block is reported', () => {
  only({ ci: CI.replace(`    paths-ignore:\n${IGNORE_BLOCK}\n`, '') }, /has no `paths-ignore`/);
});

test('any other path filter in ci.yml is reported: push.paths, or anything under pull_request', () => {
  only({ ci: CI.replace('    paths-ignore:\n', "    paths: ['apps/**']\n    paths-ignore:\n") }, /`push\.paths` is declared/);
  for (const key of ['paths', 'paths-ignore']) {
    const ci = CI.replace(
      '  pull_request:\n    branches: [main, develop-2.2]\n',
      `  pull_request:\n    branches: [main, develop-2.2]\n    ${key}: ['docs/**']\n`
    );
    const p = only({ ci }, new RegExp(`\`pull_request\\.${key}\` is declared`));
    assert.match(p.message, /Pending/);
  }
});

test('dropping workflow_call is reported: release.yml reuses ci.yml', () => {
  only({ ci: CI.replace('  workflow_call:\n', '') }, /`on\.workflow_call` is gone/);
});

// ── security.yml and release.yml stay path-blind ─────────────────────────────

test('a path filter in security.yml or release.yml is reported', () => {
  const security = SECURITY.replace(
    "    branches: [main, 'develop-*', 'release/*']\n",
    "    branches: [main, 'develop-*', 'release/*']\n    paths-ignore: ['docs/**']\n"
  );
  assert.match(only({ security }, /declares a path filter/).file, /security\.yml$/);
  const release = RELEASE.replace("      - 'v*'\n", "      - 'v*'\n    paths: ['apps/**']\n");
  assert.match(only({ release }, /declares a path filter/).file, /release\.yml$/);
});

// ── docs.yml: trigger ────────────────────────────────────────────────────────

test('a missing docs.yml is reported', () => {
  assert.match(only({ docs: null }, /does not exist/).file, /docs\.yml$/);
});

test('a Docs trigger narrower or wider than pinned is reported', () => {
  const narrower = problems({ docs: DOCS.replace("['docs/**', '**.md']", "['**.md']") });
  assert.ok(narrower.some(p => /missing `docs\/\*\*`/.test(p.message)));
  // The tracked PDF under docs/ is then ignored by CI and observed by nobody.
  assert.ok(narrower.some(p => /docs\/plan\.pdf.*observed by no workflow/.test(p.message)));

  only({ docs: DOCS.replace("['docs/**', '**.md']", "['docs/**', '**.md', 'apps/**']") }, /`apps\/\*\*`, which is not part/);
});

test('a Docs paths-ignore or a missing paths is reported', () => {
  const paths = "    paths: ['docs/**', '**.md']\n";
  only({ docs: DOCS.replace(paths, `${paths}    paths-ignore: ['x']\n`) }, /`push\.paths-ignore` is declared/);
  only({ docs: DOCS.replace(paths, '') }, /`push\.paths` is missing/);
});

test('`push` is the whole Docs trigger set: every other trigger is reported, harmless ones included', () => {
  assert.deepEqual([...DOCS_TRIGGERS], ['push']);
  const extras: Array<[name: string, yaml: string]> = [
    ['pull_request', '  pull_request:\n    branches: [main]\n'],
    ['pull_request_target', '  pull_request_target:\n    branches: [main]\n'],
    ['merge_group', '  merge_group:\n'],
    ['workflow_dispatch', '  workflow_dispatch:\n'],
    ['schedule', "  schedule:\n    - cron: '0 6 * * 1'\n"],
  ];
  for (const [name, yaml] of extras) {
    const p = only({ docs: DOCS.replace('\njobs:', `${yaml}\njobs:`) }, /is not part of the pinned contract/);
    assert.ok(p.message.includes(`contains \`${name}\``), p.message);
  }
  // And the set is required, not merely bounded: losing `push` is reported too.
  assert.ok(
    problems({ docs: DOCS.replace('  push:\n', '  merge_group:\n') }).some(p => /`on` is missing `push`/.test(p.message))
  );
});

test('Docs branches must cover main and the active release train, and survive a cycle switch by pattern', () => {
  const branches = "[main, 'develop-*', 'release/*']";
  only({ docs: DOCS.replace(branches, '[main]') }, /does not cover "develop-2\.2"/);
  only({ docs: DOCS.replace(branches, "['develop-*', 'release/*']") }, /does not cover "main"/);
  assert.deepEqual(
    problems({
      security: SECURITY.replace('develop-2.2', 'develop-2.3'),
      release: RELEASE.replace('develop-2.2', 'develop-2.3'),
      ci: CI.replace(/develop-2\.2/g, 'develop-2.3'),
    }),
    []
  );
});

// ── docs.yml: the job must actually perform the drift check ──────────────────

test('a Docs job with no steps is reported once per load-bearing step', () => {
  const found = problems({ docs: DOCS.replace(DOCS_STEPS, '') });
  assert.equal(found.length, 3, JSON.stringify(found, null, 2));
  assert.ok(found.some(p => /does not check out the repository/.test(p.message)));
  assert.ok(found.some(p => /does not run `\.\/\.github\/actions\/setup-workspace`/.test(p.message)));
  assert.ok(found.some(p => /no step whose `run:` is exactly `pnpm check:drift`/.test(p.message)));
});

test('removing or replacing any one step is reported', () => {
  only({ docs: DOCS.replace('      - uses: actions/checkout@v7\n', '') }, /does not check out the repository/);
  only({ docs: DOCS.replace('      - uses: ./.github/actions/setup-workspace\n', '') }, /does not run `\.\/\.github\/actions\/setup-workspace`/);
  only({ docs: DOCS.replace('run: pnpm check:drift', 'run: echo ok') }, /no step whose `run:` is exactly `pnpm check:drift`/);
  // The contract is the inline one-line form; a block scalar is not read.
  only({ docs: DOCS.replace('        run: pnpm check:drift', '        run: |\n          pnpm check:drift') }, /inline one-line form only/);
});

test('the Docs job carries no `if:` and no `continue-on-error:`, at any level or in any form', () => {
  const drift = '      - name: Docs & skills drift\n';
  const cases: Array<[label: string, docs: string]> = [
    ['job-level if: false', DOCS.replace('    runs-on: ubuntu-latest\n', '    if: false\n    runs-on: ubuntu-latest\n')],
    ['drift-step if: false', DOCS.replace(drift, `${drift}        if: false\n`)],
    ['drift-step continue-on-error: true', DOCS.replace(drift, `${drift}        continue-on-error: true\n`)],
    [
      'setup-step continue-on-error: true',
      DOCS.replace('      - uses: ./.github/actions/setup-workspace\n', '      - uses: ./.github/actions/setup-workspace\n        continue-on-error: true\n'),
    ],
    // The absence of the key is the contract, so the benign spellings go red too.
    ['job-level if: true', DOCS.replace('    runs-on: ubuntu-latest\n', '    if: true\n    runs-on: ubuntu-latest\n')],
    ['drift-step if: success()', DOCS.replace(drift, `${drift}        if: success()\n`)],
    ['drift-step continue-on-error: false', DOCS.replace(drift, `${drift}        continue-on-error: false\n`)],
    // First key of a step, where the dash and the key share a line.
    ['checkout-step - if: true', DOCS.replace('      - uses: actions/checkout@v7\n', '      - if: true\n        uses: actions/checkout@v7\n')],
  ];
  for (const [label, docs] of cases) {
    const p = only({ docs }, /must be unconditional and must fail the run/);
    assert.match(p.message, /declares `(if|continue-on-error):`/, label);
  }
});

test('a second job is reported even when the named job is intact', () => {
  const docs = `${DOCS}  extra:\n    name: Something else\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo hi\n`;
  assert.ok(problems({ docs }).some(p => /declares 2 jobs; exactly one/.test(p.message)));
});

test('the Docs job must carry its name and must not reuse a ci.yml job name', () => {
  const renamed = problems({ docs: DOCS.replace('name: Documentation drift', 'name: Migrations') });
  assert.equal(renamed.length, 2, JSON.stringify(renamed, null, 2));
  assert.ok(renamed.some(p => /named `Migrations`, not `Documentation drift`/.test(p.message)));
  assert.ok(renamed.some(p => /reuses a ci\.yml job name/.test(p.message)));
  only({ docs: DOCS.replace('name: Documentation drift', 'name: Docs drift') }, /named `Docs drift`, not/);
});

// ── The tracked tree ─────────────────────────────────────────────────────────

test('an allowlist entry matching no tracked file is drift, and an empty tree is all drift', () => {
  only({}, /`tools\/README\.md` matches no tracked file/, TRACKED.filter(f => f !== 'tools/README.md'));
  const empty = problems({}, []);
  assert.equal(empty.length, CI_DOCUMENTATION_PATHS_IGNORE.length);
  assert.ok(empty.every(p => /matches no tracked file/.test(p.message)));
});

test('the default tracked list comes from git ls-files', () => {
  const dir = workflowsDir();
  for (const path of TRACKED) {
    mkdirSync(join(dir, dirname(path)), { recursive: true });
    writeFileSync(join(dir, path), '');
  }
  execFileSync('git', ['init', '-q'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['add', '-A'], { cwd: dir, stdio: 'ignore' });
  assert.deepEqual(checkWorkflowPaths(dir), []);
});

// ── Parsing fails closed rather than passing ─────────────────────────────────

test('an unreadable shape is an error, not a pass', () => {
  const empty = CI.replace(`    paths-ignore:\n${IGNORE_BLOCK}\n`, '    paths-ignore:\n');
  assert.throws(() => problems({ ci: empty }), WorkflowPathError);
  assert.throws(() => problems({ ci: CI.replace(`    paths-ignore:\n${IGNORE_BLOCK}\n`, '    paths-ignore: docs\n') }), WorkflowPathError);
  assert.throws(() => problems({ ci: CI.replace('on:\n', 'trigger:\n') }), WorkflowPathError);
  assert.throws(() => problems({ docs: DOCS.replace('jobs:\n', 'tasks:\n') }), WorkflowPathError);
});

// ── The contract, path by path ───────────────────────────────────────────────

const skipsCi = (path: string): boolean => CI_DOCUMENTATION_PATHS_IGNORE.some(p => matchesPathFilter(p, path));
const observedByDocs = (path: string): boolean => DOCS_TRIGGER_PATHS.some(p => matchesPathFilter(p, path));

test('which paths skip CI, and which of them the Docs workflow still observes', () => {
  const rows: Array<[path: string, skips: boolean, observed: boolean]> = [
    // Documentation-owned: CI skipped, Docs observes.
    ['docs/a.md', true, true],
    ['docs/a.pdf', true, true],
    ['docs/decisions/001-first.md', true, true],
    ['docs/archive/deep/nested/note.md', true, true],
    ['README.md', true, true],
    ['CLAUDE.md', true, true],
    ['lessons.md', true, true],
    ['lessons-archive.md', true, true],
    ['API_SETUP.md', true, true],
    ['APP_CONFIG.md', true, true],
    ['OPERATIONS.md', true, true],
    ['SETUP_STATUS.md', true, true],
    ['INTEGRATIONS_ROADMAP.md', true, true],
    ['apps/api/README.md', true, true],
    ['packages/core/README.md', true, true],
    ['tools/README.md', true, true],
    ['.claude/skills/luke-audit/SKILL.md', true, true],
    ['.claude/skills/luke-deps/references/platform-policy.md', true, true],
    // Outside the ownership surface: full CI, and Docs too where Markdown or docs/.
    ['docs/helper.ts', false, true],
    ['docs/image.png', false, true],
    ['docs/data.json', false, true],
    ['CHANGELOG.md', false, true],
    ['apps/api/SECURITY.md', false, true],
    ['apps/web/src/content/help.md', false, true],
    ['apps/web/src/lib/README.md', false, true],
    ['packages/core/src/README.md', false, true],
    ['NEW.md', false, true],
    ['tools/reports/x.md', false, true],
    ['tools/scripts/__fixtures__/docs/x.md', false, true],
    ['apps/api/test/fixtures/x.md', false, true],
    ['.github/README.md', false, true],
    // Outside, and not Markdown: full CI only.
    ['README.MD', false, false],
    ['.github/workflows/x.yml', false, false],
    ['.claude/skills/luke-x/run.sh', false, false],
    ['.claude/settings.json', false, false],
    ['apps/api/src/index.ts', false, false],
    ['package.json', false, false],
    ['pnpm-lock.yaml', false, false],
    ['packages/db/prisma/schema.prisma', false, false],
  ];
  for (const [path, skips, observed] of rows) {
    assert.equal(skipsCi(path), skips, `${path}: skips CI`);
    assert.equal(observedByDocs(path), observed, `${path}: observed by Docs`);
  }
});

// ── GitHub's path filter globbing ────────────────────────────────────────────

test('matchesPathFilter implements GitHub path filter semantics', () => {
  // `**/` may match zero directories: the documented examples.
  assert.equal(matchesPathFilter('docs/**/*.md', 'docs/README.md'), true);
  assert.equal(matchesPathFilter('docs/**/*.md', 'docs/a/markdown/file.md'), true);
  assert.equal(matchesPathFilter('**/README.md', 'README.md'), true);
  assert.equal(matchesPathFilter('**/README.md', 'js/README.md'), true);
  // Extension and directory prefix are literal; a dot is a dot.
  assert.equal(matchesPathFilter('docs/**/*.md', 'docs/a.mdx'), false);
  assert.equal(matchesPathFilter('docs/**/*.md', 'docsx/a.md'), false);
  assert.equal(matchesPathFilter('README.md', 'READMEXmd'), false);
  // `**` crosses `/`; `*` does not.
  assert.equal(matchesPathFilter('**.md', 'a/b/c.md'), true);
  assert.equal(matchesPathFilter('**.md', 'a.md.txt'), false);
  assert.equal(matchesPathFilter('docs/**', 'docs/a/b.pdf'), true);
  assert.equal(matchesPathFilter('docs/**', 'docs'), false);
  assert.equal(matchesPathFilter('docs/*', 'docs/a/b.md'), false);
  assert.equal(matchesPathFilter('apps/*/README.md', 'apps/api/README.md'), true);
  assert.equal(matchesPathFilter('apps/*/README.md', 'apps/api/src/README.md'), false);
  assert.equal(matchesPathFilter('apps/*/README.md', 'apps/README.md'), false);
});
