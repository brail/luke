/**
 * Behavioral proof for `check-release-train.ts`.
 *
 * The module decides whether an explicit release target may be prepared here,
 * and a stable tag publishes `latest`. So the cases are lifecycles, not unit
 * inputs: each builds the branch and tag topology a real cycle produces and
 * asserts the verdict that falls out of it.
 *
 * **Every commit carries an explicit author and committer date**, and one case
 * replays another with all of them moved by a year. That is not decoration: the
 * defect this module exists to remove was git-cliff's date-ordered walk
 * answering `v2.1.5` for a range holding two breaking changes, because a
 * merged-in stable tag was dated after them. A suite that let git choose the
 * timestamps could not tell a topological answer from a lucky one.
 *
 * Run: `pnpm test:tools`
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

import { ReleaseTrainError, validateTarget } from './check-release-train';
import { REPO_ROOT } from './lib/report';

const created: string[] = [];

after(() => {
  for (const dir of created) rmSync(dir, { recursive: true, force: true });
});

/**
 * Identity and signing in the environment rather than in `git config` calls per
 * fixture: env beats repository-local config, so a developer's global
 * `commit.gpgsign = true` cannot reach these throwaway repositories by any
 * route. This suite runs inside `.husky/pre-push`, where a pinentry prompt
 * becomes a push that never completes, reported as a failure pointing at the
 * wrong thing.
 */
const GIT_CONFIG: Record<string, string> = {
  'commit.gpgsign': 'false',
  'tag.gpgsign': 'false',
};

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'train',
  GIT_AUTHOR_EMAIL: 'train@test.local',
  GIT_COMMITTER_NAME: 'train',
  GIT_COMMITTER_EMAIL: 'train@test.local',
  // Derived, never hand-counted: git reads exactly GIT_CONFIG_COUNT pairs and
  // ignores the rest in silence, so a count left behind by an added key would
  // let the signing preference this block exists to suppress back in.
  GIT_CONFIG_COUNT: String(Object.keys(GIT_CONFIG).length),
  ...Object.fromEntries(
    Object.entries(GIT_CONFIG).flatMap(([key, value], i) => [
      [`GIT_CONFIG_KEY_${i}`, key],
      [`GIT_CONFIG_VALUE_${i}`, value],
    ])
  ),
};

function git(repo: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd: repo,
    encoding: 'utf-8',
    env: GIT_ENV,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

/**
 * A repository carrying the real `.cliff.toml`.
 *
 * The configuration is the fixture's, not a copy of a copy: the parser table it
 * declares — which commits are skipped, which count as breaking — is exactly
 * what decides the minimum bump, so a suite running against a different one
 * would prove nothing about this repository's releases.
 */
function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'luke-train-'));
  created.push(dir);

  git(dir, 'init', '-q', '-b', 'main');
  copyFileSync(join(REPO_ROOT, '.cliff.toml'), join(dir, '.cliff.toml'));
  git(dir, 'add', '-A');
  commit(dir, 'chore: the configuration under test');
  return dir;
}

/** Seconds apart, so ordering is deterministic and every date is explicit. */
let clock = 0;

function at(offsetDays = 0): string {
  clock += 1;
  const base = Date.UTC(2026, 0, 1, 12, 0, 0) + offsetDays * 86_400_000;
  return new Date(base + clock * 1000).toISOString();
}

function commit(dir: string, message: string, date = at()): void {
  execFileSync('git', ['commit', '-q', '--allow-empty', '-m', message], {
    cwd: dir,
    encoding: 'utf-8',
    env: { ...GIT_ENV, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function merge(dir: string, branch: string, message: string, date = at()): void {
  execFileSync('git', ['merge', '-q', '--no-ff', '-m', message, branch], {
    cwd: dir,
    encoding: 'utf-8',
    env: { ...GIT_ENV, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/** One released version behind HEAD: the state almost every case starts from. */
function afterStable(tag = 'v2.1.4'): string {
  const dir = repo();
  commit(dir, 'chore: previous cycle');
  git(dir, 'tag', tag);
  return dir;
}

/** `assert.throws` predicate: a gate rejection whose reason matches. */
function reason(re: RegExp) {
  return (err: unknown) =>
    err instanceof ReleaseTrainError && re.test(err.message);
}

function rejects(dir: string, tag: string, re: RegExp): void {
  assert.throws(() => validateTarget(dir, tag), reason(re), `expected ${tag} to be refused`);
}

/**
 * The lifecycle that motivated the module: a release train whose breaking work
 * is *older* than the stable hotfix later merged into it.
 *
 * `dayShift` moves every timestamp without touching the topology, which is what
 * the second test uses to prove the verdict is not read off the clock.
 */
function lukeShape(dayShift = 0): string {
  const dir = repo();
  commit(dir, 'chore: previous cycle', at(dayShift));
  git(dir, 'tag', 'v2.1.3');

  git(dir, 'checkout', '-q', '-b', 'develop-2.2');
  commit(dir, 'feat(storage)!: swap the provider', at(dayShift + 1));
  commit(dir, 'fix(api): a train fix', at(dayShift + 2));

  // The hotfix is committed and tagged *after* the breaking work above, which
  // is precisely what made the date-ordered walk file that work under v2.1.4.
  git(dir, 'checkout', '-q', 'main');
  commit(dir, 'fix(deps): stable hotfix', at(dayShift + 10));
  git(dir, 'tag', 'v2.1.4');

  git(dir, 'checkout', '-q', 'develop-2.2');
  merge(dir, 'main', 'chore(release): synchronize v2.1.4', at(dayShift + 11));
  commit(dir, 'fix(web): after the sync', at(dayShift + 12));
  return dir;
}

// ── The defect, and its invariance to the clock ──────────────────────────────

test('a breaking commit older than the base tag still sets a major floor', () => {
  const dir = lukeShape();

  const v = validateTarget(dir, 'v3.0.0-rc.1');
  assert.equal(v.kind, 'rc-first');
  assert.equal(v.base, 'v2.1.4');
  assert.equal(v.range, 'v2.1.4..HEAD');
  assert.equal(v.ignore, '.*');
  assert.equal(v.min, 'v3.0.0');
});

test('the verdict does not move when every date moves', () => {
  const early = validateTarget(lukeShape(-400), 'v3.0.0-rc.1');
  const late = validateTarget(lukeShape(400), 'v3.0.0-rc.1');

  // `config` is each fixture's own path and differs by construction; every
  // other field is the verdict itself.
  assert.deepEqual({ ...early, config: '' }, { ...late, config: '' });
  assert.equal(early.min, 'v3.0.0');
});

// ── The minimum bump ─────────────────────────────────────────────────────────

test('a target below the minimum is refused; at or above it is accepted', () => {
  const dir = lukeShape();

  for (const tag of ['v2.1.5-rc.1', 'v2.2.0-rc.1']) {
    rejects(dir, tag, /below v3\.0\.0, the minimum/);
  }
  for (const tag of ['v3.0.0-rc.1', 'v3.1.0-rc.1', 'v4.0.0-rc.1']) {
    assert.equal(validateTarget(dir, tag).kind, 'rc-first');
  }
});

test('the minimum follows the commits, not the shape of the tag', () => {
  const cases: Array<[string, string, string]> = [
    // The lowest refusable target for a patch bump is a version below the base
    // itself: there is nothing between v2.1.4 and its own patch successor.
    ['fix(api): a fix', 'v2.1.5', 'v2.0.1'],
    ['feat(api): a feature', 'v2.2.0', 'v2.1.5'],
    ['feat(api)!: a breaking feature', 'v3.0.0', 'v2.2.0'],
    ['fix(api): a fix\n\nBREAKING CHANGE: the contract moved', 'v3.0.0', 'v2.2.0'],
  ];

  for (const [message, minimum, tooLow] of cases) {
    const dir = repo();
    commit(dir, 'chore: previous cycle');
    git(dir, 'tag', 'v2.1.4');
    commit(dir, message);

    assert.equal(
      validateTarget(dir, minimum).min,
      minimum,
      `expected ${message.split('\n')[0]} to require ${minimum}`
    );
    rejects(dir, tooLow, /below/);
  }
});

test('a range with nothing but skipped commits is refused', () => {
  for (const target of ['v2.2.0', 'v2.2.0-rc.1']) {
    const dir = repo();
    commit(dir, 'chore: previous cycle');
    git(dir, 'tag', 'v2.1.4');
    // Every parser in .cliff.toml that drops a commit rather than grouping it.
    commit(dir, 'style: reformat');
    commit(dir, 'chore(release): synchronize');
    commit(dir, 'Merge pull request #1 from brail/x');

    // One fact, one wording, whichever call found it: the minimum-bump read
    // for a stable target, the render-range read for a candidate.
    rejects(dir, target, /v2\.1\.4\.\.HEAD carries no releasable commit/);
  }
});

// ── Trains: one target, frozen, counter only ─────────────────────────────────

/** A train at rc.1 whose work is a plain feature, plus a commit after it. */
function trainAtRc1(): string {
  const dir = afterStable();
  git(dir, 'checkout', '-q', '-b', 'develop-3.0');
  commit(dir, 'feat(api): the cycle work');
  git(dir, 'tag', 'v3.0.0-rc.1');
  commit(dir, 'fix(api): candidate feedback');
  return dir;
}

test('an open train freezes its target and advances only the counter', () => {
  const dir = trainAtRc1();

  const next = validateTarget(dir, 'v3.0.0-rc.2');
  assert.equal(next.kind, 'rc-next');
  assert.equal(next.base, 'v3.0.0-rc.1');
  assert.equal(next.range, 'v3.0.0-rc.1..HEAD');
  assert.equal(next.ignore, '.*');
  // The target is frozen: nothing recomputes a bump for a candidate.
  assert.equal(next.min, null);

  rejects(dir, 'v3.0.0-rc.3', /the next one is v3\.0\.0-rc\.2/);
  rejects(dir, 'v3.1.0-rc.1', /train targets v3\.0\.0, not v3\.1\.0/);
  rejects(dir, 'v3.1.0', /train targets v3\.0\.0, not v3\.1\.0/);
});

test('a candidate needs commits of its own', () => {
  const dir = trainAtRc1();
  git(dir, 'tag', 'v3.0.0-rc.2');

  rejects(dir, 'v3.0.0-rc.3', /carries no releasable commit/);
});

test('graduation starts at the previous stable and erases the rc boundaries', () => {
  const dir = trainAtRc1();

  const g = validateTarget(dir, 'v3.0.0');
  assert.equal(g.kind, 'stable');
  assert.equal(g.base, 'v2.1.4');
  assert.equal(g.range, 'v2.1.4..HEAD');
  assert.equal(g.ignore, '.*-rc\\..*');
  assert.equal(g.min, 'v2.2.0');
});

test('a graduation below the minimum the train grew into is refused', () => {
  const dir = afterStable();
  git(dir, 'checkout', '-q', '-b', 'develop-2.2');
  commit(dir, 'feat(api): the cycle work');
  git(dir, 'tag', 'v2.2.0-rc.1');
  // Accepted mid-train, which the frozen target permits — and which is exactly
  // why the graduation has to refuse: the train can no longer publish 2.2.0.
  commit(dir, 'feat(api)!: a breaking change nobody planned');

  assert.equal(validateTarget(dir, 'v2.2.0-rc.2').kind, 'rc-next');
  rejects(dir, 'v2.2.0', /below v3\.0\.0, the minimum/);
  rejects(dir, 'v3.0.0-rc.1', /train targets v2\.2\.0/);
});

test('a stable hotfix merged into the train lands in the next candidate', () => {
  const dir = afterStable();
  git(dir, 'checkout', '-q', '-b', 'develop-3.0');
  commit(dir, 'feat(api): the cycle work');
  git(dir, 'tag', 'v3.0.0-rc.1');

  git(dir, 'checkout', '-q', 'main');
  commit(dir, 'fix(deps): a later hotfix');
  git(dir, 'tag', 'v2.1.5');
  git(dir, 'checkout', '-q', 'develop-3.0');
  merge(dir, 'main', 'chore(release): synchronize v2.1.5');
  commit(dir, 'fix(web): more candidate feedback');

  const next = validateTarget(dir, 'v3.0.0-rc.2');
  assert.equal(next.kind, 'rc-next');
  assert.equal(next.base, 'v3.0.0-rc.1');
  // Every tag ignored, so the merged-in stable release does not split the
  // candidate's section in two.
  assert.equal(next.ignore, '.*');
});

test('a hotfix on the stable line releases from the last stable', () => {
  const dir = afterStable();
  commit(dir, 'feat(api): the cycle work');
  git(dir, 'tag', 'v3.0.0-rc.1');
  git(dir, 'tag', 'v3.0.0');
  commit(dir, 'fix(api): a hotfix after the release');

  const v = validateTarget(dir, 'v3.0.1');
  assert.equal(v.kind, 'stable');
  assert.equal(v.base, 'v3.0.0');
  assert.equal(v.min, 'v3.0.1');
});

test('an abandoned train below the stable line is not a train', () => {
  const dir = repo();
  commit(dir, 'chore: the cycle that shipped as 2.0.0 instead');
  git(dir, 'tag', 'v1.10.0-rc.1');
  git(dir, 'tag', 'v1.10.0-rc.2');
  commit(dir, 'feat(api): later work');
  git(dir, 'tag', 'v2.1.4');
  commit(dir, 'feat(api): the real cycle');

  // v1.10.0 is ungraduated and will never be tagged; it must not own the next
  // release, nor make this one ambiguous.
  const v = validateTarget(dir, 'v2.2.0-rc.1');
  assert.equal(v.kind, 'rc-first');
  assert.equal(v.base, 'v2.1.4');
});

// ── Fail-closed states ───────────────────────────────────────────────────────

test('an existing tag is never re-cut', () => {
  const dir = trainAtRc1();
  rejects(dir, 'v3.0.0-rc.1', /already exists/);
  rejects(dir, 'v2.1.4', /already exists/);
});

test('an unmerged higher stable refuses the release', () => {
  const dir = afterStable();
  git(dir, 'checkout', '-q', '-b', 'develop-3.0');
  commit(dir, 'feat(api): the cycle work');

  git(dir, 'checkout', '-q', 'main');
  commit(dir, 'fix(deps): a hotfix this branch never took');
  git(dir, 'tag', 'v2.1.5');
  git(dir, 'checkout', '-q', 'develop-3.0');

  rejects(dir, 'v3.0.0-rc.1', /v2\.1\.5 exists but is not reachable/);
});

test('an unmerged candidate for the same target refuses the release', () => {
  const dir = afterStable();
  git(dir, 'checkout', '-q', '-b', 'develop-3.0');
  commit(dir, 'feat(api): the cycle work');
  git(dir, 'tag', 'v3.0.0-rc.1');
  git(dir, 'checkout', '-q', 'main');
  commit(dir, 'fix(api): stable-line work');

  // Same repository, same train — just not merged here. Publishing v3.0.0 from
  // this branch would consume the number without the work.
  rejects(dir, 'v3.0.0', /v3\.0\.0-rc\.1 exist but are not reachable/);
  rejects(dir, 'v3.0.0-rc.2', /v3\.0\.0-rc\.1 exist but are not reachable/);
});

test('two ungraduated trains are ambiguous', () => {
  const dir = afterStable();
  commit(dir, 'feat(api): one train');
  git(dir, 'tag', 'v3.0.0-rc.1');
  commit(dir, 'feat(api): another train');
  git(dir, 'tag', 'v3.1.0-rc.1');

  rejects(dir, 'v3.0.0-rc.2', /2 ungraduated trains are reachable/);
});

test('a malformed target is refused before anything is read', () => {
  const dir = trainAtRc1();

  for (const bad of [
    'v3.0.0-rc1',
    'v3.0.0-rc.0',
    'v3.0.0-rc.01',
    'v3.0',
    'v3.0.0.1',
    '3.0.0',
    'v03.0.0',
    'v3.0.0-beta.1',
    'latest',
  ]) {
    rejects(dir, bad, /is not a release tag/);
  }
});

test('no reachable stable tag is refused', () => {
  const dir = repo();
  commit(dir, 'feat(api): the beginning');

  rejects(dir, 'v1.0.0', /no stable tag is reachable/);
});

test('a shallow clone is refused', () => {
  const src = trainAtRc1();
  const dest = mkdtempSync(join(tmpdir(), 'luke-train-shallow-'));
  created.push(dest);
  rmSync(dest, { recursive: true, force: true });
  execFileSync('git', ['clone', '-q', '--depth', '1', `file://${src}`, dest], {
    env: GIT_ENV,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  assert.equal(git(dest, 'rev-parse', '--is-shallow-repository'), 'true');
  rejects(dest, 'v3.0.0-rc.2', /shallow clone/);
});

test('a missing .cliff.toml is refused rather than answered from defaults', () => {
  const dir = trainAtRc1();
  rmSync(join(dir, '.cliff.toml'));

  rejects(dir, 'v3.0.0-rc.2', /does not exist.*silently fall back/s);
});

test('a tag inside the range is refused, because the base is not the boundary', () => {
  const dir = afterStable();
  // A lower stable tag on a side branch, merged in afterwards: reachable, below
  // the base, and a release boundary git-cliff will not ignore for a graduation.
  git(dir, 'checkout', '-q', '-b', 'side');
  commit(dir, 'fix(api): work tagged as an older release');
  git(dir, 'tag', 'v2.1.2');
  git(dir, 'checkout', '-q', 'main');
  merge(dir, 'side', 'chore: bring the side branch in');
  commit(dir, 'feat(api): the cycle work');

  rejects(dir, 'v2.2.0', /release boundaries/);
});

test('a base commit shared with another tag is refused, not guessed at', () => {
  const dir = afterStable();
  // The same commit also carries the candidate it was graduated from. git-cliff
  // keeps one tag per commit, so the base it resolves may not be the one this
  // gate selected.
  git(dir, 'tag', 'v2.1.4-rc.7');
  commit(dir, 'feat(api): the cycle work');

  rejects(dir, 'v2.2.0-rc.1', /shares its commit with v2\.1\.4-rc\.7/);
});

test('the working tree does not change the verdict', () => {
  const dir = lukeShape();
  const clean = validateTarget(dir, 'v3.0.0-rc.1');

  // The state release-prepare.sh refuses to start from, and the state it is in
  // between its two writers: neither may reach this verdict.
  writeFileSync(join(dir, 'package.json'), '{"version":"9.9.9"}\n');
  writeFileSync(join(dir, 'CHANGELOG.md'), '## [9.9.9]\n\n- invented\n');

  assert.deepEqual(validateTarget(dir, 'v3.0.0-rc.1'), clean);
});

// ── CLI contract ─────────────────────────────────────────────────────────────

interface Run {
  status: number;
  stdout: string;
  stderr: string;
}

function runCli(args: string[]): Run {
  try {
    const stdout = execFileSync(
      process.execPath,
      ['--import', 'tsx', join(__dirname, 'check-release-train.ts'), ...args],
      { encoding: 'utf-8', env: GIT_ENV, stdio: ['ignore', 'pipe', 'pipe'] }
    );
    return { status: 0, stdout, stderr: '' };
  } catch (err) {
    const failure = err as { status?: number; stdout?: string; stderr?: string };
    return {
      status: failure.status ?? -1,
      stdout: failure.stdout ?? '',
      stderr: failure.stderr ?? '',
    };
  }
}

test('the CLI prints exactly the key=value lines release-prepare.sh reads', () => {
  const dir = lukeShape();

  const ok = runCli(['--validate', 'v3.0.0-rc.1', '--repo', dir]);
  assert.equal(ok.status, 0, ok.stderr);
  assert.deepEqual(ok.stdout.trimEnd().split('\n'), [
    'kind=rc-first',
    'version=3.0.0-rc.1',
    'range=v2.1.4..HEAD',
    'ignore=.*',
    `config=${join(dir, '.cliff.toml')}`,
    'min=v3.0.0',
  ]);

  // A frozen target has no minimum to print, and the line still has to be there
  // for the shell that reads it.
  const train = runCli(['--validate', 'v3.0.0-rc.2', '--repo', trainAtRc1()]);
  assert.equal(train.status, 0, train.stderr);
  assert.match(train.stdout, /^kind=rc-next$/m);
  assert.match(train.stdout, /^min=$/m);
});

test('the CLI refuses every malformed invocation', () => {
  const dir = lukeShape();

  // Every rejection leaves through one `catch`, so two runs prove the contract:
  // a malformed invocation and a refused release both exit 1 behind the same
  // prefix. The remaining argv shapes are asserted in-process above.
  const cases: Array<[string[], RegExp]> = [
    [[], /Nothing to do/],
    [['--validate', 'v2.1.5-rc.1', '--repo', dir], /below v3\.0\.0/],
  ];

  for (const [args, expected] of cases) {
    const run = runCli(args);
    assert.equal(run.status, 1, `expected ${JSON.stringify(args)} to exit 1`);
    assert.match(run.stderr, /^\[release-train\] REJECTED — /);
    assert.match(run.stderr, expected, `wrong reason for ${JSON.stringify(args)}`);
  }
});
