/**
 * Behavioral proof for the two preconditions `scripts/release-prepare.sh`
 * enforces before it consults anything else: the remote is fresh, and HEAD is
 * on the side of the stable line the tag being prepared belongs to.
 *
 * The guard is shell, and this repository has no Bash test framework — but it
 * does not need one. Both preconditions run before the validator is invoked and
 * before a single file is written, so every case can be driven by executing the
 * real script in a throwaway git repository with no workspace and no
 * `node_modules`. What is asserted is exactly what they are for: the
 * diagnostic, the exit status, and that the tree is untouched.
 *
 * ## Why the guard exists
 *
 * `check-release-train.ts` is deliberately branch-agnostic — tag topology and
 * commit reachability, nothing else — so on the release train it will happily
 * validate the train's own stable target. Preparing there rewrote CHANGELOG.md
 * and every governed manifest, the pre-push hook then accepted the tag
 * because CHANGELOG and versions genuinely did match, and only release.yml
 * refused it, by which point an invalid stable tag already existed on the
 * remote. A publication gate that fails closed is not enough when it fails last.
 *
 * ## Why the branch name is not enough
 *
 * A local branch called `main` can be reset onto the train, or diverge from
 * `origin/main` any other way. It is then not a continuation of the stable line
 * and could only reach the remote by force, which the `main integrity` ruleset
 * forbids — so a tag cut on it is unpublishable, and nothing after the fact can
 * repair that. The accepting path therefore proves ancestry in *both*
 * directions, and the mutation test at the bottom is what keeps it that way.
 *
 * ## Why the fetch is a precondition and not advice
 *
 * Every question the validator then asks is asked of local refs: is this tag
 * already taken, does a hotfix outrank this line, where is the stable line.
 * Stale local knowledge answers all three wrongly and silently, so the script
 * refreshes them itself and refuses to continue when it cannot.
 *
 * Run: `pnpm test:tools`
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

import { REPO_ROOT } from './lib/report';

const created: string[] = [];

after(() => {
  for (const dir of created) rmSync(dir, { recursive: true, force: true });
});

/**
 * Fully local git configuration, in the environment.
 *
 * `commit.gpgsign = true` in a developer's ~/.gitconfig is inherited by every
 * repository, including throwaway ones, and makes `git commit` fail outright
 * (`gpg failed to sign the data`) or block on a pinentry prompt. This suite
 * runs inside `.husky/pre-push`, so that would turn a signing preference into a
 * push that cannot complete, with an error pointing at the wrong thing.
 */
const GIT_CONFIG: Record<string, string> = {
  'commit.gpgsign': 'false',
  'tag.gpgsign': 'false',
};

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'guard',
  GIT_AUTHOR_EMAIL: 'guard@test.local',
  GIT_COMMITTER_NAME: 'guard',
  GIT_COMMITTER_EMAIL: 'guard@test.local',
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
 * A repository carrying the real script, and — unless `withRemote` is false —
 * a bare `origin` it can actually fetch from.
 *
 * `transform` lets one test install a weakened copy of the guard; every other
 * test runs the script exactly as it ships.
 */
function repoWithScript(
  options: { transform?: (source: string) => string; withRemote?: boolean } = {}
): string {
  const dir = mkdtempSync(join(tmpdir(), 'luke-stableline-'));
  created.push(dir);

  git(dir, 'init', '-q', '-b', 'main');

  mkdirSync(join(dir, 'scripts'), { recursive: true });
  const src = join(REPO_ROOT, 'scripts/release-prepare.sh');
  if (options.transform === undefined) {
    copyFileSync(src, join(dir, 'scripts/release-prepare.sh'));
  } else {
    writeFileSync(
      join(dir, 'scripts/release-prepare.sh'),
      options.transform(readFileSync(src, 'utf-8'))
    );
  }

  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'chore: the script under test');

  if (options.withRemote !== false) {
    const origin = mkdtempSync(join(tmpdir(), 'luke-stableline-origin-'));
    created.push(origin);
    git(origin, 'init', '-q', '--bare', '-b', 'main');
    git(dir, 'remote', 'add', 'origin', origin);
    git(dir, 'push', '-q', 'origin', 'main');
  }

  return dir;
}

interface Run {
  status: number;
  output: string;
}

/** The script needs no workspace to reach its preconditions, so none is given. */
function prepare(repo: string, tag: string): Run {
  try {
    const output = execFileSync('bash', ['scripts/release-prepare.sh', tag], {
      cwd: repo,
      encoding: 'utf-8',
      env: GIT_ENV,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, output };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { status: e.status ?? -1, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

/** mode, object id, stage and path for every tracked file — byte-level identity. */
function trackedState(repo: string): string {
  return git(repo, 'ls-files', '-s');
}

const REJECTED = /HEAD is not on the stable line/;
const ACCEPTED = /Stable line confirmed/;
const FETCHED = /Refreshing tags and origin\/main/;

/** A release train ahead of the stable line the bare origin publishes. */
function withTrain(repo: string): string {
  git(repo, 'checkout', '-q', '-b', 'develop-2.2');
  git(repo, 'commit', '-q', '--allow-empty', '-m', 'feat: train work');
  git(repo, 'tag', 'v3.0.0-rc.1');
  return git(repo, 'rev-parse', 'HEAD');
}

// ── The fetch is a precondition, not advice ──────────────────────────────────

test('without a remote the script stops before it judges anything', () => {
  const repo = repoWithScript({ withRemote: false });
  withTrain(repo);
  const before = trackedState(repo);

  const run = prepare(repo, 'v3.0.0');

  assert.notEqual(run.status, 0);
  assert.match(run.output, /No `origin` remote/);
  // It cannot have reached either verdict: both are answered from refs it just
  // failed to refresh.
  assert.doesNotMatch(run.output, ACCEPTED);
  assert.doesNotMatch(run.output, REJECTED);
  assert.equal(git(repo, 'status', '--porcelain'), '');
  assert.equal(trackedState(repo), before);
});

test('an unreachable remote stops the release rather than using stale refs', () => {
  const repo = repoWithScript();
  withTrain(repo);
  git(repo, 'remote', 'set-url', 'origin', join(tmpdir(), 'luke-no-such-remote'));

  const run = prepare(repo, 'v3.0.0');

  assert.notEqual(run.status, 0);
  assert.match(run.output, /Could not fetch from origin/);
  assert.doesNotMatch(run.output, ACCEPTED);
  assert.doesNotMatch(run.output, REJECTED);
});

// ── Rejecting states ─────────────────────────────────────────────────────────

test('a stable tag on the release train is rejected before anything is written', () => {
  const repo = repoWithScript();
  withTrain(repo);
  const before = trackedState(repo);

  const run = prepare(repo, 'v3.0.0');

  assert.notEqual(run.status, 0, 'the script must exit non-zero');
  assert.match(run.output, FETCHED);
  assert.match(run.output, REJECTED);
  assert.doesNotMatch(run.output, ACCEPTED);
  assert.equal(git(repo, 'status', '--porcelain'), '', 'no file may be modified');
  assert.equal(trackedState(repo), before, 'tracked files must be byte-identical');
});

test('a candidate cut on the stable line is rejected too', () => {
  const repo = repoWithScript();
  const before = trackedState(repo);

  // HEAD is the tip of main, which origin/main also points at: exactly where a
  // candidate may not be cut.
  const run = prepare(repo, 'v3.0.0-rc.1');

  assert.notEqual(run.status, 0);
  assert.match(run.output, /released as a stable tag, not as/);
  assert.equal(trackedState(repo), before);
});

test('a local main that diverges from origin/main is rejected despite the name', () => {
  const repo = repoWithScript();
  const train = withTrain(repo);

  // The branch is called `main` and its tip is not a descendant of origin/main:
  // reset onto the train is one way to get here, and it could only reach the
  // remote by force, which is forbidden.
  git(repo, 'checkout', '-q', 'main');
  git(repo, 'commit', '-q', '--allow-empty', '-m', 'chore: work only on local main');
  git(repo, 'push', '-q', '--force', 'origin', `${train}:refs/heads/main`);

  assert.equal(git(repo, 'rev-parse', '--abbrev-ref', 'HEAD'), 'main');
  const before = trackedState(repo);
  const run = prepare(repo, 'v3.0.0');

  assert.notEqual(run.status, 0);
  assert.match(run.output, REJECTED);
  assert.equal(git(repo, 'status', '--porcelain'), '');
  assert.equal(trackedState(repo), before);
});

// ── The accepting state, so the guard cannot pass by always refusing ─────────

test('a local main that continues origin/main gets past both preconditions', () => {
  const repo = repoWithScript();
  withTrain(repo);

  git(repo, 'checkout', '-q', 'main');
  git(repo, 'merge', '-q', '--no-ff', '-m', 'chore: merge release train', 'develop-2.2');

  const run = prepare(repo, 'v3.0.0');

  // It goes no further than the guard here: the next step shells out to the
  // validator through `pnpm`, which this fixture deliberately does not provide.
  // Reaching that point is the assertion — a legitimate graduation was let
  // through.
  assert.match(run.output, FETCHED);
  assert.match(run.output, ACCEPTED);
  assert.doesNotMatch(run.output, REJECTED);
});

// ── The interface itself ─────────────────────────────────────────────────────

test('the modes are gone and say so, and a missing tag prints usage', () => {
  const repo = repoWithScript();

  for (const mode of ['auto', 'rc', 'stable']) {
    const run = prepare(repo, mode);
    assert.notEqual(run.status, 0, `expected "${mode}" to be refused`);
    assert.match(run.output, /the modes are gone/);
    assert.match(run.output, /Usage: pnpm release:prepare <tag>/);
  }

  const empty = prepare(repo, '');
  assert.notEqual(empty.status, 0);
  assert.match(empty.output, /Name the release you are preparing/);
});

test('a malformed tag is refused by the guard before the grammar sees it', () => {
  const repo = repoWithScript();
  withTrain(repo);

  // `v3.0.0-rc1` — the canonical typo — does not match the `*-rc.*` glob that
  // routes to the candidate half, so it is judged as a stable tag and refused
  // for being on the train. `parseReleaseTag`, inside `--validate`, is what
  // would call it malformed, and it runs after this guard. That ordering is
  // deliberate: moving the grammar first would put `pnpm exec` ahead of the
  // guard and cost this suite its hermetic fixture. Pinned so the diagnostic is
  // a known cost rather than a surprise, and so a future reorder is a decision.
  const run = prepare(repo, 'v3.0.0-rc1');

  assert.notEqual(run.status, 0);
  assert.match(run.output, REJECTED);
  assert.equal(git(repo, 'status', '--porcelain'), '', 'nothing may be written');
});

// ── Mutation: the ancestry half is load-bearing ──────────────────────────────

test('dropping the ancestry condition lets a divergent local main through', () => {
  const weakened = (source: string): string => {
    const strong = `  elif [ "$current_branch" = "$stable_branch" ] &&
    git merge-base --is-ancestor "$STABLE_REF" HEAD 2>/dev/null; then`;
    assert.ok(
      source.includes(strong),
      'the guard no longer has the shape this mutation targets — update the test'
    );
    return source.replace(strong, `  elif [ "$current_branch" = "$stable_branch" ]; then`);
  };

  const repo = repoWithScript({ transform: weakened });
  const train = withTrain(repo);

  git(repo, 'checkout', '-q', 'main');
  git(repo, 'commit', '-q', '--allow-empty', '-m', 'chore: work only on local main');
  git(repo, 'push', '-q', '--force', 'origin', `${train}:refs/heads/main`);

  const run = prepare(repo, 'v3.0.0');

  // Branch name alone: the divergent tree is waved through, which is the
  // regression this test exists to catch.
  assert.match(run.output, ACCEPTED);
  assert.doesNotMatch(run.output, REJECTED);
});
