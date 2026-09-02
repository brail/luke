/**
 * Behavioral proof for the stable-line guard in `scripts/release-prepare.sh`.
 *
 * The guard is shell, and this repository has no Bash test framework — but it
 * does not need one. The guard runs before `check-release-train.ts` is invoked
 * and before a single file is written, so every rejecting case can be driven by
 * executing the real script in a throwaway git repository with no workspace,
 * no node_modules and no `pnpm` reachable. What is asserted is exactly what the
 * guard is for: the diagnostic, the exit status, and that the tree is
 * untouched.
 *
 * ## Why the guard exists
 *
 * `check-release-train.ts` is deliberately branch-agnostic — tag topology and
 * nothing else — so on the release train it finds the ungraduated train and
 * answers with its stable version. Preparing there rewrote CHANGELOG.md and all
 * seven package.json files, the pre-push hook then accepted the tag because
 * CHANGELOG and versions genuinely did match, and only release.yml refused it,
 * by which point an invalid stable tag already existed on the remote. A
 * publication gate that fails closed is not enough when it fails last.
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
 * Run: `pnpm test:tools`
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

import { REPO_ROOT } from './lib/report';

const created: string[] = [];

after(() => {
  for (const dir of created) rmSync(dir, { recursive: true, force: true });
});

function git(repo: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd: repo,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

/**
 * A repository carrying the real script, with fully local git configuration so
 * a developer's global `commit.gpgsign` cannot reach the fixtures.
 *
 * `transform` lets one test install a weakened copy of the guard; every other
 * test runs the script exactly as it ships.
 */
function repoWithScript(transform?: (source: string) => string): string {
  const dir = mkdtempSync(join(tmpdir(), 'luke-stableline-'));
  created.push(dir);

  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 'guard@test.local');
  git(dir, 'config', 'user.name', 'guard');
  git(dir, 'config', 'commit.gpgsign', 'false');
  git(dir, 'config', 'tag.gpgsign', 'false');

  mkdirSync(join(dir, 'scripts'), { recursive: true });
  const src = join(REPO_ROOT, 'scripts/release-prepare.sh');
  if (transform === undefined) {
    copyFileSync(src, join(dir, 'scripts/release-prepare.sh'));
  } else {
    writeFileSync(join(dir, 'scripts/release-prepare.sh'), transform(readFileSync(src, 'utf-8')));
  }

  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'chore: the script under test');
  return dir;
}

interface Run {
  status: number;
  output: string;
}

/** The script needs no workspace to reach its guard, so none is provided. */
function runStable(repo: string): Run {
  try {
    const output = execFileSync('bash', ['scripts/release-prepare.sh', 'stable'], {
      cwd: repo,
      encoding: 'utf-8',
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

/** origin/main at the initial commit, plus a release train ahead of it. */
function withTrain(repo: string): { base: string; train: string } {
  const base = git(repo, 'rev-parse', 'HEAD');
  git(repo, 'update-ref', 'refs/remotes/origin/main', base);

  git(repo, 'checkout', '-q', '-b', 'develop-2.2');
  git(repo, 'commit', '-q', '--allow-empty', '-m', 'feat: train work');
  git(repo, 'tag', 'v3.0.0-rc.1');
  const train = git(repo, 'rev-parse', 'HEAD');

  return { base, train };
}

// ── Rejecting states ─────────────────────────────────────────────────────────

test('stable mode on the release train is rejected before anything is written', () => {
  const repo = repoWithScript();
  withTrain(repo);
  const before = trackedState(repo);

  const run = runStable(repo);

  assert.notEqual(run.status, 0, 'the script must exit non-zero');
  assert.match(run.output, REJECTED);
  assert.doesNotMatch(run.output, ACCEPTED);
  assert.equal(git(repo, 'status', '--porcelain'), '', 'no file may be modified');
  assert.equal(trackedState(repo), before, 'tracked files must be byte-identical');
});

test('a local main that diverges from origin/main is rejected despite the name', () => {
  const repo = repoWithScript();
  const { train } = withTrain(repo);

  // The branch is called `main` and its tip is not a descendant of origin/main:
  // reset onto the train is one way to get here, and it could only reach the
  // remote by force, which is forbidden.
  git(repo, 'checkout', '-q', 'main');
  git(repo, 'commit', '-q', '--allow-empty', '-m', 'chore: work only on local main');
  git(repo, 'update-ref', 'refs/remotes/origin/main', train);

  assert.equal(git(repo, 'rev-parse', '--abbrev-ref', 'HEAD'), 'main');
  assert.throws(
    () => git(repo, 'merge-base', '--is-ancestor', 'refs/remotes/origin/main', 'HEAD'),
    'the fixture must actually be divergent'
  );

  const before = trackedState(repo);
  const run = runStable(repo);

  assert.notEqual(run.status, 0);
  assert.match(run.output, REJECTED);
  assert.equal(git(repo, 'status', '--porcelain'), '');
  assert.equal(trackedState(repo), before);
});

// ── The accepting state, so the guard cannot pass by always refusing ─────────

test('a local main that continues origin/main gets past the guard', () => {
  const repo = repoWithScript();
  withTrain(repo);

  git(repo, 'checkout', '-q', 'main');
  git(repo, 'merge', '-q', '--no-ff', '-m', 'chore: merge release train', 'develop-2.2');

  const run = runStable(repo);

  // It goes no further than the guard here: the next step shells out to `pnpm`,
  // which this fixture deliberately does not provide. Reaching that point is
  // the assertion — the guard let a legitimate graduation through.
  assert.match(run.output, ACCEPTED);
  assert.doesNotMatch(run.output, REJECTED);
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

  const repo = repoWithScript(weakened);
  const { train } = withTrain(repo);

  git(repo, 'checkout', '-q', 'main');
  git(repo, 'commit', '-q', '--allow-empty', '-m', 'chore: work only on local main');
  git(repo, 'update-ref', 'refs/remotes/origin/main', train);

  const run = runStable(repo);

  // Branch name alone: the divergent tree is waved through, which is the
  // regression this test exists to catch.
  assert.match(run.output, ACCEPTED);
  assert.doesNotMatch(run.output, REJECTED);
});
