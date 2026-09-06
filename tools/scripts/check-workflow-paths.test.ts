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
 * The aggregate `CI gate` is covered the same way, plus one thing a fixture
 * cannot express: its pinned script is executed here, against each dependency
 * result GitHub can produce, so "only `success` passes" is a demonstrated
 * property rather than a string comparison.
 *
 * `Security gate` — the pre-merge context for pull requests on `main` — is
 * covered by the same mutations over a security.yml fixture, plus the ones
 * only it has: the pull_request trigger and its target, the condition pinned
 * to each class of job, the notifier that must stay off pull requests, and the
 * jobs deliberately outside the gate. That fixture is written out literally
 * rather than built from the checker's constants; the constants are compared
 * against the same literals in a test of their own, so neither side can drift
 * into agreeing with the other. It shares the executed-script proof above,
 * which one test ties to it by asserting both gates pin the same literal.
 *
 * Run: `pnpm test:tools`
 */

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';

import {
  CI_DOCUMENTATION_PATHS_IGNORE,
  CI_GATE_IF,
  CI_GATE_NAME,
  DOCS_TRIGGER_PATHS,
  DOCS_TRIGGERS,
  GATED_PULL_REQUEST_TYPES,
  GATE_RESULTS,
  GATE_RUN,
  GATE_SHELL,
  SECURITY_GATE_IF,
  SECURITY_GATE_NAME,
  SECURITY_GATE_STEP,
  SECURITY_NOTIFIER_IF,
  SECURITY_NOTIFIER_JOB,
  SECURITY_PR_BRANCHES,
  SECURITY_SCAN_IF,
  SECURITY_TRIGGERS,
  SECURITY_WEEKLY_IF,
  SECURITY_WEEKLY_JOBS,
  WorkflowPathError,
  checkWorkflowPaths,
  matchesPathFilter,
} from './check-workflow-paths';
import { type Problem } from './lib/report';

const created: string[] = [];

after(() => {
  for (const dir of created) rmSync(dir, { recursive: true, force: true });
});

/**
 * The pre-merge trigger, its own literal so a mutation can replace the whole
 * block rather than a prefix of it. `types:` is spelled out for the same
 * reason as everything else here: it is the contract, not a copy of it.
 */
const SECURITY_PR_TRIGGER = `  pull_request:
    branches: [main]
    types: [opened, synchronize, reopened, edited]
`;

/**
 * The Security gate, its own literal so the mutations below can lift it out or
 * rewrite one line of it. Every value here is written by hand for the reason
 * given on the fixture: interpolating the checker's constants would make the
 * comparison a tautology.
 */
const SECURITY_GATE_BLOCK = `  gate:
    name: Security gate
    needs: [semgrep, gitleaks, osv]
    if: \${{ always() && github.event_name != 'schedule' }}
    runs-on: ubuntu-latest
    steps:
      - name: Require every scan to have succeeded
        shell: bash
        env:
          RESULTS: \${{ join(needs.*.result, ' ') }}
        run: echo "results=$RESULTS"; set -- $RESULTS; [ $# -gt 0 ] || exit 1; for r in "$@"; do [ "$r" = success ] || exit 1; done
`;

/**
 * security.yml as approved, spelled out literally rather than built from the
 * checker's constants. A fixture that interpolated the values under test would
 * follow them through any edit and go on passing — the mutations below would
 * then prove only that the file differs from itself. The constants are
 * compared against these same literals in their own test instead.
 *
 * Every property the security tests assert is written here by hand: the four
 * triggers, the pull_request target, each job's condition, the gate's name,
 * needs, step name, shell, RESULTS binding and script.
 */
const SECURITY = `name: security

on:
  push:
    branches: [main, 'develop-*', 'release/*']
${SECURITY_PR_TRIGGER}  schedule:
    - cron: '0 6 * * 1'
  workflow_dispatch:

env:
  RELEASE_TRAIN_BRANCH: develop-2.2

jobs:
  semgrep:
    if: github.event_name != 'schedule'
    runs-on: ubuntu-latest
    steps:
      - run: semgrep scan --config p/typescript --error
  gitleaks:
    if: github.event_name != 'schedule'
    runs-on: ubuntu-latest
    steps:
      - run: gitleaks detect --source .
  osv:
    if: github.event_name != 'schedule'
    runs-on: ubuntu-latest
    steps:
      - uses: google/osv-scanner-action/osv-scanner-action@v2.5.1
${SECURITY_GATE_BLOCK}  osv-weekly:
    if: github.event_name == 'schedule' || github.event_name == 'workflow_dispatch'
    runs-on: ubuntu-latest
    steps:
      - uses: google/osv-scanner-action/osv-scanner-action@v2.5.1
  osv-weekly-release-train:
    if: github.event_name == 'schedule' || github.event_name == 'workflow_dispatch'
    runs-on: ubuntu-latest
    steps:
      - uses: google/osv-scanner-action/osv-scanner-action@v2.5.1
  notify-on-failure:
    needs: [semgrep, gitleaks, osv, osv-weekly, osv-weekly-release-train]
    if: always() && github.event_name != 'pull_request' && contains(needs.*.result, 'failure')
    runs-on: ubuntu-latest
    steps:
      - uses: actions/github-script@v9
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

/**
 * ci.yml's pre-merge trigger, written out by hand like security.yml's. The two
 * targets differ — this one covers the train as well — but the activity set is
 * the same contract, and each file states it independently so a mutation of
 * one cannot be masked by the other.
 */
const CI_PR_TRIGGER = `  pull_request:
    branches: [main, develop-2.2]
    types: [opened, synchronize, reopened, edited]
`;

/**
 * The gate, built from the checker's own constants so the fixture cannot drift
 * from the contract, with every line a fixture below mutates named once here.
 */
const GATE_NEEDS = '[checks, integration, migrations]';
const GATE_STEP_LINE = '      - name: Require every job to have succeeded';
const GATE_SHELL_LINE = `        shell: ${GATE_SHELL}`;
const GATE_ENV_LINE = `          RESULTS: ${GATE_RESULTS}`;
const GATE_RUN_LINE = `        run: ${GATE_RUN}`;

const CI_GATE_JOB = `  gate:
    name: ${CI_GATE_NAME}
    needs: ${GATE_NEEDS}
    if: ${CI_GATE_IF}
    runs-on: ubuntu-latest
    steps:
${GATE_STEP_LINE}
${GATE_SHELL_LINE}
        env:
${GATE_ENV_LINE}
${GATE_RUN_LINE}
`;

const CI = `name: CI

on:
  push:
    branches: [main, develop-2.2]
    # Documentation ownership surface.
    paths-ignore:
${IGNORE_BLOCK}
${CI_PR_TRIGGER}  # Reused by release.yml.
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
${CI_GATE_JOB}`;

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

// ── ci.yml: the shared pull_request contract ─────────────────────────────────

test("ci.yml pins the same pull_request activity set, stated independently of security.yml's", () => {
  // The accepted set, spelled out here rather than shared with the security
  // fixture: two files declare this contract, so each must be able to go red
  // on its own.
  assert.deepEqual(problems(), []);
  // `edited` is what retargeting fires — the reason the set is pinned at all.
  only({ ci: CI.replace(', edited]', ']') }, /`pull_request\.types` is missing `edited`/);
  only({ ci: CI.replace('opened, synchronize, reopened, edited', 'opened, reopened, edited') }, /`pull_request\.types` is missing `synchronize`/);
  only({ ci: CI.replace('[opened, synchronize', '[synchronize') }, /`pull_request\.types` is missing `opened`/);
  only({ ci: CI.replace('reopened, edited]', 'edited]') }, /`pull_request\.types` is missing `reopened`/);
  only({ ci: CI.replace('reopened, edited]', 'reopened, edited, edited]') }, /`pull_request\.types` lists `edited` twice/);
  only({ ci: CI.replace('reopened, edited]', 'reopened, edited, labeled]') }, /contains `labeled`, which is not one of the activities the gates are pinned to/);
  only({ ci: CI.replace('    types: [opened, synchronize, reopened, edited]\n', '') }, /`pull_request` declares no `types`/);
  // Unreadable shapes fail closed, never quietly.
  assert.throws(() => problems({ ci: CI.replace('[opened, synchronize, reopened, edited]', '[]') }), WorkflowPathError);
  assert.throws(
    () => problems({ ci: CI.replace(CI_PR_TRIGGER, '  pull_request: {branches: [main], types: [opened]}\n') }),
    WorkflowPathError
  );
  // ci.yml keeps its own targets; the branch checker owns them, not this one.
  assert.deepEqual(problems({ ci: CI.replace('branches: [main, develop-2.2]\n    types:', 'branches: [main, develop-2.3]\n    types:') }), []);
});

// ── ci.yml: the aggregate gate ───────────────────────────────────────────────

test('a gate that is absent or carries any other name is reported', () => {
  only({ ci: CI.replace(CI_GATE_JOB, '') }, /no job is named `CI gate`/);
  // A ruleset matches a context byte for byte, so case will be part of the name.
  only({ ci: CI.replace(`name: ${CI_GATE_NAME}`, 'name: CI Gate') }, /no job is named `CI gate`/);
});

test("the gate needs ci.yml's other jobs: no omission, no duplicate, no name that is not a job", () => {
  only({ ci: CI.replace(GATE_NEEDS, '[checks, migrations]') }, /`needs` is missing `integration`/);
  only({ ci: CI.replace(GATE_NEEDS, '[checks, integration, migrations, e2e]') }, /contains `e2e`, which is not a job in ci\.yml/);
  only({ ci: CI.replace(GATE_NEEDS, '[checks, checks, integration, migrations]') }, /`needs` lists `checks` twice/);
  // No `needs:` at all is every job missing, one problem each — not one vague failure.
  const none = problems({ ci: CI.replace(`    needs: ${GATE_NEEDS}\n`, '') });
  assert.deepEqual(
    none.map(p => p.message),
    ['checks', 'integration', 'migrations'].map(id => `\`${CI_GATE_NAME}\`'s \`needs\` is missing \`${id}\`.`)
  );
});

test('a job added to ci.yml and not to the gate is reported, and adding it to both is green', () => {
  const browser = '  browser:\n    name: Browser Component Tests\n    runs-on: ubuntu-latest\n';
  const added = CI.replace('  migrations:\n', `${browser}  migrations:\n`);
  only({ ci: added }, /`needs` is missing `browser`/);
  assert.deepEqual(problems({ ci: added.replace(GATE_NEEDS, '[checks, browser, integration, migrations]') }), []);
});

test('the gate must run always(): a missing or different condition is reported', () => {
  only({ ci: CI.replace(`    if: ${CI_GATE_IF}\n`, '') }, /declares no `if:`/);
  // The semantic opposite, and the unwrapped near-miss that reads as correct.
  for (const expr of ['${{ success() }}', 'always()']) {
    only({ ci: CI.replace(`if: ${CI_GATE_IF}`, `if: ${expr}`) }, /not `if: \$\{\{ always\(\) \}\}`/);
  }
});

test('any second condition on the gate is reported', () => {
  const p = only({ ci: CI.replace(GATE_RUN_LINE, `        if: false\n${GATE_RUN_LINE}`) }, /besides its job-level `if: \$\{\{ always\(\) \}\}`/);
  assert.match(p.message, /declares `if:`/);
});

test('a continue-on-error on the gate is reported by both rules that forbid it', () => {
  // Two contracts, both true: the gate may carry no control key besides its
  // own `always()`, and no job in ci.yml may tolerate its own failure.
  const cases: Array<[label: string, ci: string]> = [
    ['job-level', CI.replace(`    if: ${CI_GATE_IF}\n`, `    if: ${CI_GATE_IF}\n    continue-on-error: true\n`)],
    ['step-level', CI.replace(GATE_RUN_LINE, `        continue-on-error: true\n${GATE_RUN_LINE}`)],
    // The absence of the key is the contract, so the benign spelling goes red too.
    ['step-level, false', CI.replace(GATE_RUN_LINE, `        continue-on-error: false\n${GATE_RUN_LINE}`)],
  ];
  for (const [label, ci] of cases) {
    const found = problems({ ci });
    assert.equal(found.length, 2, `${label}: ${JSON.stringify(found, null, 2)}`);
    assert.ok(found.some(p => /besides its job-level `if: \$\{\{ always\(\) \}\}`/.test(p.message)), label);
    assert.ok(found.some(p => /a job that reports success while it failed/.test(p.message)), label);
  }
});

test('a continue-on-error on an upstream ci.yml job is reported: the gate would inherit that success', () => {
  // The fail-open surface the aggregate gate cannot see for itself. `checks`
  // failing while tolerating its own failure hands the gate `success`, which
  // is the one result the pinned script accepts.
  only({ ci: CI.replace('  checks:\n', '  checks:\n    continue-on-error: true\n') }, /a job that reports success while it failed/);
  only(
    { ci: CI.replace('      - name: Lint\n        run: pnpm lint', '      - name: Lint\n        continue-on-error: true\n        run: pnpm lint') },
    /a job that reports success while it failed/
  );
  // Every occurrence, not only the first, and at distinct lines.
  const twice = problems({ ci: CI.replace('  checks:\n', '  checks:\n    continue-on-error: true\n').replace('  integration:\n', '  integration:\n    continue-on-error: true\n') });
  assert.equal(twice.length, 2, JSON.stringify(twice, null, 2));
  assert.ok(twice.every(p => /declares `continue-on-error:`/.test(p.message)));
  assert.notEqual(twice[0].line, twice[1].line);
  assert.ok(twice.every(p => /ci\.yml$/.test(p.file)));
});

test('the gate does no work of its own: no uses, and exactly the pinned run', () => {
  only({ ci: CI.replace(GATE_STEP_LINE, `      - uses: actions/checkout@v7\n${GATE_STEP_LINE}`) }, /no checkout, workspace setup, install or build/);
  only({ ci: CI.replace(GATE_RUN_LINE, '        run: exit 0') }, /steps are not exactly one `run:`/);
  only({ ci: CI.replace(GATE_RUN_LINE, `${GATE_RUN_LINE}\n      - run: pnpm install`) }, /steps are not exactly one `run:`/);
  // Reformatted as a block scalar the script is unchanged, but the checker no
  // longer reads it, and silence would be a pass.
  only({ ci: CI.replace(GATE_RUN_LINE, `        run: |\n          ${GATE_RUN}`) }, /steps are not exactly one `run:`/);
});

test('the gate pins the shell that gives the pinned script its semantics', () => {
  only({ ci: CI.replace(`${GATE_SHELL_LINE}\n`, '') }, /declares no `shell:`/);
  for (const shell of ['sh', 'pwsh', 'python']) {
    only({ ci: CI.replace(GATE_SHELL_LINE, `        shell: ${shell}`) }, new RegExp(`declares \`shell: ${shell}\`, not \`shell: bash\``));
  }
  // A shell template is not an interpreter of the script: this one prints it and exits 0.
  const echoed = only({ ci: CI.replace(GATE_SHELL_LINE, '        shell: echo {0}') }, /would report success without executing it at all/);
  assert.match(echoed.message, /declares `shell: echo \{0\}`/);
  // Two declarations leave the winner to GitHub's precedence rules rather than to this file.
  only({ ci: CI.replace(GATE_SHELL_LINE, `${GATE_SHELL_LINE}\n${GATE_SHELL_LINE}`) }, /declares 2 `shell:` keys/);
  only(
    { ci: CI.replace(GATE_SHELL_LINE, `${GATE_SHELL_LINE}\n        shell: sh`) },
    /declares 2 `shell:` keys/
  );
  // Right value, wrong level: the step that carries the script is what must say
  // it. Rewritten inside the gate block, since `runs-on:` is not unique in CI.
  const atJobLevel = CI_GATE_JOB.replace(`${GATE_SHELL_LINE}\n`, '').replace('    runs-on:', `    shell: ${GATE_SHELL}\n    runs-on:`);
  only({ ci: CI.replace(CI_GATE_JOB, atJobLevel) }, /at job level; it belongs on the step/);
});

test('the gate must read its dependencies results, not a value of its own', () => {
  only({ ci: CI.replace(`${GATE_ENV_LINE}\n`, '') }, /binds no `RESULTS`/);
  only({ ci: CI.replace(GATE_ENV_LINE, '          RESULTS: success') }, /binds `RESULTS: success`, not/);
  only(
    { ci: CI.replace(GATE_RESULTS, "${{ join(needs.*.result, ',') }}") },
    /binds `RESULTS: \$\{\{ join\(needs\.\*\.result, ','\) \}\}`, not/
  );
});

/**
 * The gate's own script, executed the way GitHub executes a step that declares
 * `shell: bash` — `bash --noprofile --norc -eo pipefail <file>`, a file rather
 * than `-c`, which is what the workflow now pins rather than inherits.
 */
const gateScript = ((): string => {
  const dir = mkdtempSync(join(tmpdir(), 'luke-gate-'));
  created.push(dir);
  const file = join(dir, 'gate.sh');
  writeFileSync(file, GATE_RUN);
  return file;
})();

function gateExit(results: string): number {
  const argv = ['--noprofile', '--norc', '-eo', 'pipefail', gateScript];
  return spawnSync(GATE_SHELL, argv, { env: { ...process.env, RESULTS: results }, encoding: 'utf8' }).status ?? -1;
}

test('the pinned script accepts only success, and rejects every other dependency result', () => {
  assert.equal(gateExit('success'), 0);
  assert.equal(gateExit('success success success success'), 0);
  for (const results of [
    // The three results a dependency can end with besides success.
    'failure',
    'cancelled',
    'skipped',
    // One bad result among good ones, in every position.
    'failure success success',
    'success cancelled success',
    'success success skipped',
    // A result GitHub might add later, and near misses.
    'neutral',
    'SUCCESS',
    'successful',
    // `needs` resolving to nothing: no iteration is not a pass.
    '',
    '   ',
  ]) {
    assert.notEqual(gateExit(results), 0, `results=${JSON.stringify(results)}`);
  }
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

// ── security.yml: the pre-merge gate for pull requests on main ───────────────

test('the exported security contract is exactly the approved literals', () => {
  // The fixture spells these out by hand; this is where the two are tied
  // together, so neither can drift into agreeing with the other by accident.
  assert.deepEqual([...SECURITY_TRIGGERS], ['push', 'pull_request', 'schedule', 'workflow_dispatch']);
  assert.deepEqual([...SECURITY_PR_BRANCHES], ['main']);
  assert.deepEqual([...GATED_PULL_REQUEST_TYPES], ['opened', 'synchronize', 'reopened', 'edited']);
  assert.deepEqual([...SECURITY_WEEKLY_JOBS], ['osv-weekly', 'osv-weekly-release-train']);
  assert.equal(SECURITY_NOTIFIER_JOB, 'notify-on-failure');
  assert.equal(SECURITY_GATE_NAME, 'Security gate');
  assert.equal(SECURITY_GATE_STEP, 'Require every scan to have succeeded');
  assert.equal(SECURITY_GATE_IF, "${{ always() && github.event_name != 'schedule' }}");
  assert.equal(SECURITY_SCAN_IF, "github.event_name != 'schedule'");
  assert.equal(SECURITY_WEEKLY_IF, "github.event_name == 'schedule' || github.event_name == 'workflow_dispatch'");
  assert.equal(SECURITY_NOTIFIER_IF, "always() && github.event_name != 'pull_request' && contains(needs.*.result, 'failure')");
});

test('both aggregate gates are judged by the same executed script, shell and input', () => {
  // So the execution proof above covers this gate too: one script, not two
  // that happen to look alike.
  assert.ok(CI.includes(`run: ${GATE_RUN}`));
  assert.ok(SECURITY.includes(`run: ${GATE_RUN}`));
  assert.ok(SECURITY.includes(`shell: ${GATE_SHELL}`));
  assert.ok(SECURITY.includes(`RESULTS: ${GATE_RESULTS}`));
});

test('a missing pull_request trigger is reported, in either gated workflow', () => {
  // Twice, deliberately: the trigger-set pin says the workflow lost a trigger,
  // the shared pull_request contract says the gate would never report on a
  // pull request. The second is what covers ci.yml, which has no trigger-set
  // pin of its own, so the overlap is what makes the rule stand alone there.
  const gone = problems({ security: SECURITY.replace(SECURITY_PR_TRIGGER, '') });
  assert.equal(gone.length, 2, JSON.stringify(gone, null, 2));
  assert.ok(gone.some(p => /`on` is missing `pull_request`/.test(p.message)));
  assert.ok(gone.some(p => /`pull_request` is missing; the aggregate gate would never report/.test(p.message)));
  // ci.yml has only the second, and it must still be reported there.
  only({ ci: CI.replace(CI_PR_TRIGGER, '') }, /`pull_request` is missing; the aggregate gate would never report/);
});

test('the pull_request target is exactly main, and never a branch that dies at the end of a cycle', () => {
  const wrong = problems({ security: SECURITY.replace('    branches: [main]\n', '    branches: [develop-2.2]\n') });
  assert.equal(wrong.length, 2, JSON.stringify(wrong, null, 2));
  assert.ok(wrong.some(p => /`pull_request\.branches` is missing `main`/.test(p.message)));
  assert.ok(wrong.some(p => /contains `develop-2\.2`, which is not the stable line/.test(p.message)));
  only({ security: SECURITY.replace('    branches: [main]\n', "    branches: [main, 'develop-*']\n") }, /contains `develop-\*`, which is not the stable line/);
  only({ security: SECURITY.replace(SECURITY_PR_TRIGGER, '  pull_request:\n    types: [opened, synchronize, reopened, edited]\n') }, /`pull_request` declares no `branches`/);
});

test('the pull_request activity types are pinned: the default set omits the one a retarget fires', () => {
  // `edited` is what a pull request retargeted at `main` fires. Left out, that
  // pull request produces no run and the gate sits Pending on a head SHA
  // nothing judged — the whole reason the types are spelled at all.
  only({ security: SECURITY.replace(', edited]', ']') }, /`pull_request\.types` is missing `edited`/);
  // The other three are just as required: dropping `synchronize` means the
  // gate judges the first commit of a pull request and no later one.
  only({ security: SECURITY.replace('opened, synchronize, reopened, edited', 'opened, reopened, edited') }, /`pull_request\.types` is missing `synchronize`/);
  only({ security: SECURITY.replace('[opened, synchronize', '[synchronize') }, /`pull_request\.types` is missing `opened`/);
  only({ security: SECURITY.replace('reopened, edited]', 'edited]') }, /`pull_request\.types` is missing `reopened`/);
  only({ security: SECURITY.replace('opened, synchronize, reopened, edited', 'opened, synchronize, reopened, edited, edited') }, /`pull_request\.types` lists `edited` twice/);
  only(
    { security: SECURITY.replace('reopened, edited]', 'reopened, edited, labeled]') },
    /contains `labeled`, which is not one of the activities the gates are pinned to/
  );
  // An empty list matches no event at all — read as an error, never a pass.
  assert.throws(() => problems({ security: SECURITY.replace('[opened, synchronize, reopened, edited]', '[]') }), WorkflowPathError);
  only({ security: SECURITY.replace('    types: [opened, synchronize, reopened, edited]\n', '') }, /`pull_request` declares no `types`/);
});

test('a pull_request written in a form the checker cannot read is an error, not a pass', () => {
  // An inline flow mapping keeps the key visible to the trigger-set check
  // while hiding the branches, the types and any path filter from the readers
  // that pin them. Silence there would report a retargeted, path-filtered,
  // train-targeting gate as compliant.
  const inline = SECURITY.replace(SECURITY_PR_TRIGGER, "  pull_request: {branches: [develop-2.2], paths-ignore: ['docs/**']}\n");
  assert.throws(() => problems({ security: inline }), WorkflowPathError);
});

test('a comment inside a job does not hide the rest of it', () => {
  // `section()` used to end a job at the first line indented two spaces or
  // less, and a comment is such a line. Everything after it — here a
  // step-level condition that skips the scan on a pull request while the job
  // still reports success — became invisible to every per-job rule.
  const hidden = SECURITY.replace(
    '      - run: gitleaks detect --source .',
    "  # a note about the scan\n      - if: github.event_name == 'push'\n        run: gitleaks detect --source ."
  );
  only({ security: hidden }, /`gitleaks` declares a second `if:`/);
  // Same for a tolerated failure written after a comment.
  const tolerated = SECURITY.replace('      - run: gitleaks detect --source .', '  # a note\n      - continue-on-error: true\n        run: gitleaks detect --source .');
  only({ security: tolerated }, /a job that reports success while it failed/);
});

test('a path filter under pull_request is reported, in either spelling', () => {
  for (const key of ['paths', 'paths-ignore']) {
    const security = SECURITY.replace(SECURITY_PR_TRIGGER, `${SECURITY_PR_TRIGGER}    ${key}: ['apps/**']\n`);
    assert.match(only({ security }, /declares a path filter/).file, /security\.yml$/);
  }
});

test('the Security gate must exist, exactly once, under exactly that name', () => {
  only({ security: SECURITY.replace(SECURITY_GATE_BLOCK, '') }, /no job is named `Security gate`/);
  // A ruleset matches a context byte for byte, so case is part of the name.
  // Exactly one problem: with no gate, the checks defined relative to it stay
  // quiet rather than reporting the gate's own job as an ordinary scan and
  // telling the notifier to watch the one job it must not.
  only({ security: SECURITY.replace('    name: Security gate\n', '    name: Security Gate\n') }, /no job is named `Security gate`/);
  // Two jobs under one name leave the required context pointing at whichever
  // of them GitHub reports.
  const twice = SECURITY.replace('  osv-weekly:', `${SECURITY_GATE_BLOCK.replace('  gate:', '  gate-2:')}  osv-weekly:`);
  assert.ok(problems({ security: twice }).some(p => /2 jobs are named `Security gate`/.test(p.message)));
});

test('the gate needs every scan job, and nothing that is not one', () => {
  only({ security: SECURITY.replace('needs: [semgrep, gitleaks, osv]', 'needs: [semgrep, gitleaks]') }, /`Security gate`'s `needs` is missing `osv`/);
  only({ security: SECURITY.replace('needs: [semgrep, gitleaks, osv]', 'needs: [semgrep, gitleaks, osv, osv]') }, /`needs` lists `osv` twice/);
  // Two different mistakes, told apart: a real job the gate deliberately does
  // not stand for, and a name no job answers to — what a rename leaves behind.
  only(
    { security: SECURITY.replace('needs: [semgrep, gitleaks, osv]', 'needs: [semgrep, gitleaks, osv, osv-weekly]') },
    /contains `osv-weekly`, which is a job this gate deliberately does not stand for/
  );
  only(
    { security: SECURITY.replace('needs: [semgrep, gitleaks, osv]', 'needs: [semgrep, gitleaks, osv, osv-push]') },
    /contains `osv-push`, which is not a job in security\.yml/
  );
});

test('a scan job added to security.yml and not to the gate is reported, and wiring it everywhere is green', () => {
  const trivy = "  trivy:\n    if: github.event_name != 'schedule'\n    runs-on: ubuntu-latest\n    steps:\n      - run: trivy fs .\n";
  const added = SECURITY.replace('  osv-weekly:', `${trivy}  osv-weekly:`);
  const found = problems({ security: added });
  assert.equal(found.length, 2, JSON.stringify(found, null, 2));
  assert.ok(found.some(p => /`Security gate`'s `needs` is missing `trivy`/.test(p.message)));
  assert.ok(found.some(p => /`notify-on-failure`'s `needs` is missing `trivy`/.test(p.message)));
  const wired = added
    .replace('needs: [semgrep, gitleaks, osv]', 'needs: [semgrep, gitleaks, osv, trivy]')
    .replace('needs: [semgrep, gitleaks, osv, osv-weekly', 'needs: [semgrep, gitleaks, osv, trivy, osv-weekly');
  assert.deepEqual(problems({ security: wired }), []);
});

test('the Security gate must run always(), and stay off the weekly schedule', () => {
  only({ security: SECURITY.replace("    if: ${{ always() && github.event_name != 'schedule' }}\n", '') }, /declares no `if:`/);
  for (const expr of [
    // Loses the schedule clause; loses always(); loses the wrapper that makes
    // it an expression at all.
    '${{ always() }}',
    "${{ github.event_name != 'schedule' }}",
    "always() && github.event_name != 'schedule'",
  ]) {
    only(
      { security: SECURITY.replace("if: ${{ always() && github.event_name != 'schedule' }}", `if: ${expr}`) },
      /not `if: \$\{\{ always\(\) && github\.event_name != 'schedule' \}\}`/
    );
  }
});

test('the Security gate is one pinned step: name, shell, RESULTS binding and script', () => {
  only({ security: SECURITY.replace('      - name: Require every scan to have succeeded\n', '') }, /steps are not exactly one named `Require every scan to have succeeded`/);
  only({ security: SECURITY.replace('      - name: Require every scan to have succeeded', '      - name: Check the results') }, /steps are not exactly one named/);
  only({ security: SECURITY.replace('        shell: bash\n', '') }, /declares no `shell:`/);
  only({ security: SECURITY.replace('        shell: bash', '        shell: sh') }, /declares `shell: sh`, not `shell: bash`/);
  only({ security: SECURITY.replace("          RESULTS: ${{ join(needs.*.result, ' ') }}\n", '') }, /binds no `RESULTS`/);
  only({ security: SECURITY.replace("RESULTS: ${{ join(needs.*.result, ' ') }}", 'RESULTS: success') }, /binds `RESULTS: success`, not/);
  only({ security: SECURITY.replace(/^ {8}run: echo .*$/m, '        run: exit 0') }, /steps are not exactly one `run:`/);
  only({ security: SECURITY.replace('      - name: Require', '      - uses: actions/checkout@v7\n      - name: Require') }, /no checkout, workspace setup, install or build/);
});

test('every non-gate job carries the pinned condition of its own set', () => {
  // Narrowed back to push, the scan is skipped on a pull request and the gate
  // fails on a skipped dependency rather than on a finding.
  only(
    { security: SECURITY.replace("  semgrep:\n    if: github.event_name != 'schedule'\n", "  semgrep:\n    if: github.event_name == 'push'\n") },
    /`semgrep` declares `if: github\.event_name == 'push'`, not/
  );
  only({ security: SECURITY.replace("  gitleaks:\n    if: github.event_name != 'schedule'\n", '  gitleaks:\n') }, /`gitleaks` declares no job-level `if:`/);
  // A step-level condition skips the work while the job still reports success.
  only(
    { security: SECURITY.replace('      - run: gitleaks detect --source .', "      - if: github.event_name == 'push'\n        run: gitleaks detect --source .") },
    /`gitleaks` declares a second `if:`/
  );
  only(
    {
      security: SECURITY.replace(
        "  osv-weekly:\n    if: github.event_name == 'schedule' || github.event_name == 'workflow_dispatch'\n",
        "  osv-weekly:\n    if: github.event_name != 'schedule'\n"
      ),
    },
    /`osv-weekly` declares `if: github\.event_name != 'schedule'`, not/
  );
  // The notifier back on pull requests: an issue per failed candidate.
  only(
    {
      security: SECURITY.replace(
        "    if: always() && github.event_name != 'pull_request' && contains(needs.*.result, 'failure')",
        "    if: always() && contains(needs.*.result, 'failure')"
      ),
    },
    /`notify-on-failure` declares `if: always\(\) && contains\(needs\.\*\.result, 'failure'\)`, not/
  );
});

test('a continue-on-error anywhere in security.yml is reported, at job or step level', () => {
  only({ security: SECURITY.replace('  osv:\n    if:', '  osv:\n    continue-on-error: true\n    if:') }, /declares `continue-on-error:`/);
  only({ security: SECURITY.replace('      - run: gitleaks detect', '      - continue-on-error: true\n        run: gitleaks detect') }, /declares `continue-on-error:`/);
  // On the gate it is reported twice, deliberately: once by the whole-file
  // prohibition, once by the gate's own "no second control key".
  const onGate = problems({ security: SECURITY.replace('        shell: bash', '        continue-on-error: true\n        shell: bash') });
  assert.equal(onGate.length, 2, JSON.stringify(onGate, null, 2));
  assert.ok(onGate.some(p => /a job that reports success while it failed/.test(p.message)));
  assert.ok(onGate.some(p => /besides its job-level `if:/.test(p.message)));
  // Every occurrence, not just the first: two tolerated jobs are two problems,
  // so fixing one does not hide the next until the following run.
  const twice = problems({
    security: SECURITY.replace('  gitleaks:\n    if:', '  gitleaks:\n    continue-on-error: true\n    if:').replace('  osv:\n    if:', '  osv:\n    continue-on-error: true\n    if:'),
  });
  assert.equal(twice.length, 2, JSON.stringify(twice, null, 2));
  assert.ok(twice.every(p => /declares `continue-on-error:`/.test(p.message)));
  assert.notEqual(twice[0].line, twice[1].line);
});

test('the notifier watches every job but itself and the gate, so a rename cannot be left behind', () => {
  const stale = problems({ security: SECURITY.replace('needs: [semgrep, gitleaks, osv, osv-weekly', 'needs: [semgrep, gitleaks, osv-push, osv-weekly') });
  assert.equal(stale.length, 2, JSON.stringify(stale, null, 2));
  assert.ok(stale.some(p => /`notify-on-failure`'s `needs` is missing `osv`/.test(p.message)));
  assert.ok(stale.some(p => /contains `osv-push`, which is not a job it can watch/.test(p.message)));
  only(
    { security: SECURITY.replace('needs: [semgrep, gitleaks, osv, osv-weekly', 'needs: [semgrep, gitleaks, osv, gate, osv-weekly') },
    /contains `gate`, which is not a job it can watch/
  );
  const gone = problems({ security: SECURITY.replace('  notify-on-failure:\n', '  notify-absent:\n') });
  assert.ok(gone.some(p => /no job `notify-on-failure`/.test(p.message)), JSON.stringify(gone, null, 2));
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
