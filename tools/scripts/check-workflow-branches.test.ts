/**
 * Behavioral proof for `check-workflow-branches.ts`.
 *
 * The checker's whole value is that it goes red when two workflow files stop
 * agreeing, so every case here breaks exactly one agreement and asserts the
 * corresponding problem is reported. A checker only ever seen green on the real
 * repository is assumed to block, not known to — and this one guards a failure
 * mode that is silent by construction, since the stale branch still exists
 * while the coverage is already gone.
 *
 * Run: `pnpm test:tools`
 */

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

import {
  WorkflowBranchError,
  checkWorkflowBranches,
  matchesFilter,
  readBranchFilter,
  readWorkflowEnv,
} from './check-workflow-branches';

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
  workflow_dispatch:

env:
  RELEASE_TRAIN_BRANCH: develop-2.2

jobs:
  osv-push:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
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

const CI = `name: CI

on:
  push:
    branches: [main, develop-2.2]
  pull_request:
    branches: [main, develop-2.2]
  workflow_call:

jobs:
  checks:
    runs-on: ubuntu-latest
`;

type Files = { security?: string; release?: string; ci?: string };

function repoWith(overrides: Files = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'luke-wfbranch-'));
  created.push(dir);
  mkdirSync(join(dir, '.github/workflows'), { recursive: true });
  writeFileSync(join(dir, '.github/workflows/security.yml'), overrides.security ?? SECURITY);
  writeFileSync(join(dir, '.github/workflows/release.yml'), overrides.release ?? RELEASE);
  writeFileSync(join(dir, '.github/workflows/ci.yml'), overrides.ci ?? CI);
  return dir;
}

// ── The shape that is correct today stays green ──────────────────────────────

test('the current arrangement reports no problems', () => {
  assert.deepEqual(checkWorkflowBranches(repoWith()), []);
});

test('a cycle switch done in every place stays green', () => {
  const problems = checkWorkflowBranches(
    repoWith({
      security: SECURITY.replace('develop-2.2', 'release/3.1'),
      release: RELEASE.replace('develop-2.2', 'release/3.1'),
      ci: CI.replace(/develop-2\.2/g, 'release/3.1'),
    })
  );
  assert.deepEqual(problems, []);
});

// ── Each drift goes red ──────────────────────────────────────────────────────

test('a train the security push filter does not match is reported', () => {
  const problems = checkWorkflowBranches(
    repoWith({
      // `feature/*` is covered by neither `develop-*` nor `release/*`.
      security: SECURITY.replace('RELEASE_TRAIN_BRANCH: develop-2.2', 'RELEASE_TRAIN_BRANCH: feature/x'),
      release: RELEASE.replace('RELEASE_TRAIN_BRANCH: develop-2.2', 'RELEASE_TRAIN_BRANCH: feature/x'),
      ci: CI.replace(/develop-2\.2/g, 'feature/x'),
    })
  );
  assert.equal(problems.length, 1);
  assert.match(problems[0].file, /security\.yml$/);
  assert.match(problems[0].message, /no push scanning/);
});

test('release.yml naming a different train than security.yml is reported', () => {
  const problems = checkWorkflowBranches(
    repoWith({ release: RELEASE.replace('RELEASE_TRAIN_BRANCH: develop-2.2', 'RELEASE_TRAIN_BRANCH: develop-2.1') })
  );
  assert.equal(problems.length, 1);
  assert.match(problems[0].file, /release\.yml$/);
  assert.match(problems[0].message, /refuse every RC tag/);
});

test('ci.yml left on the old train is reported for both triggers', () => {
  const problems = checkWorkflowBranches(
    repoWith({
      security: SECURITY.replace('develop-2.2', 'develop-2.3'),
      release: RELEASE.replace('develop-2.2', 'develop-2.3'),
      // ci.yml forgotten — the exact per-cycle miss CLAUDE.md warns about.
    })
  );
  assert.equal(problems.length, 2);
  assert.ok(problems.every(p => /ci\.yml$/.test(p.file)));
  assert.match(problems[0].message, /push filter/);
  assert.match(problems[1].message, /pull_request filter/);
});

test('ci.yml dropping main is reported', () => {
  const problems = checkWorkflowBranches(
    repoWith({ ci: CI.replace(/\[main, develop-2\.2\]/g, '[develop-2.2]') })
  );
  assert.equal(problems.length, 2);
  assert.ok(problems.every(p => /does not cover "main"/.test(p.message)));
});

// ── Parsing fails closed rather than passing ─────────────────────────────────

test('a file whose branch filter cannot be read is an error, not a pass', () => {
  assert.throws(
    () =>
      checkWorkflowBranches(
        repoWith({ ci: CI.replace('    branches: [main, develop-2.2]\n', '') })
      ),
    WorkflowBranchError
  );
});

test('a missing env key is an error, not a pass', () => {
  assert.throws(
    () =>
      checkWorkflowBranches(
        repoWith({ release: RELEASE.replace('  RELEASE_TRAIN_BRANCH: develop-2.2\n', '') })
      ),
    WorkflowBranchError
  );
});

// ── GitHub's filter globbing, which is not shell globbing ────────────────────

test('matchesFilter implements GitHub branch filter semantics', () => {
  assert.equal(matchesFilter('main', 'main'), true);
  assert.equal(matchesFilter('main', 'maintenance'), false);
  assert.equal(matchesFilter('develop-*', 'develop-2.2'), true);
  assert.equal(matchesFilter('develop-*', 'develop-2.2/sub'), false, '* must not cross /');
  assert.equal(matchesFilter('release/*', 'release/2.2'), true);
  assert.equal(matchesFilter('release/*', 'release/2.2/hotfix'), false);
  assert.equal(matchesFilter('release/**', 'release/2.2/hotfix'), true, '** crosses /');
  // A dot is a literal in a branch filter, not "any character".
  assert.equal(matchesFilter('develop-2.2', 'develop-2X2'), false);
});

test('quoted and unquoted list entries parse the same', () => {
  const list = readBranchFilter(SECURITY, 'security.yml', 'push');
  assert.deepEqual(list, ['main', 'develop-*', 'release/*']);
  assert.equal(readWorkflowEnv(SECURITY, 'security.yml', 'RELEASE_TRAIN_BRANCH'), 'develop-2.2');
});
