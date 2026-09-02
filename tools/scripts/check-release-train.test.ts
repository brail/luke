/**
 * Behavioral proof for `check-release-train.ts`.
 *
 * The module decides which release a stable tag is, and a stable tag publishes
 * `latest`. So the cases here are lifecycles, not unit inputs: each one builds
 * the branch and tag topology a real cycle produces and asserts the selection
 * that falls out of it.
 *
 * The lifecycle that motivated the module is the third test. `git describe`
 * returned the topologically nearest tag, which after a stable hotfix is merged
 * alongside a train is the hotfix — so the graduation was unpreparable from the
 * only branch a stable tag may be cut from.
 *
 * Run: `pnpm test:tools`
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

import { ReleaseTrainError, selectGraduation } from './check-release-train';

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
 * A repository whose git configuration is fully local.
 *
 * `commit.gpgsign = true` in a developer's ~/.gitconfig is inherited by every
 * repository, including throwaway ones, and makes `git commit` fail outright
 * (`gpg failed to sign the data`) or block on a pinentry prompt. This suite
 * runs inside `.husky/pre-push`, so that would turn a signing preference into a
 * push that cannot complete, with an error pointing at the wrong thing.
 */
function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'luke-train-'));
  created.push(dir);

  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 'train@test.local');
  git(dir, 'config', 'user.name', 'train');
  git(dir, 'config', 'commit.gpgsign', 'false');
  git(dir, 'config', 'tag.gpgsign', 'false');

  return dir;
}

function commit(dir: string, message: string): string {
  git(dir, 'commit', '-q', '--allow-empty', '-m', message);
  return git(dir, 'rev-parse', 'HEAD');
}

// ── The lifecycle this repository actually runs ──────────────────────────────

test('previous stable, hotfix, rc train, merge to main, then graduation', () => {
  const dir = repo();
  commit(dir, 'chore: init');
  git(dir, 'tag', 'v2.1.3');

  git(dir, 'checkout', '-q', '-b', 'develop-2.2');
  commit(dir, 'feat: train work');
  git(dir, 'tag', 'v3.0.0-rc.1');
  commit(dir, 'fix: rc feedback');
  git(dir, 'tag', 'v3.0.0-rc.2');

  git(dir, 'checkout', '-q', 'main');
  commit(dir, 'fix: stable hotfix');
  git(dir, 'tag', 'v2.1.4');
  git(dir, 'merge', '-q', '--no-ff', '-m', 'chore: merge release train', 'develop-2.2');

  // The bug: from this commit `git describe` answers v2.1.4, not the train.
  assert.equal(git(dir, 'describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*'), 'v2.1.4');

  const g = selectGraduation(dir);
  assert.equal(g.tag, 'v3.0.0');
  assert.deepEqual(g.candidates, ['v3.0.0-rc.2', 'v3.0.0-rc.1']);
  // Notes start after the previous release, so the hotfix it already published
  // is excluded by the range rather than reprinted.
  assert.equal(g.base, 'v2.1.4');
});

test('a nearer hotfix tag does not steal the selection', () => {
  const dir = repo();
  commit(dir, 'chore: init');
  git(dir, 'tag', 'v2.1.3');
  commit(dir, 'feat: train work');
  git(dir, 'tag', 'v3.0.0-rc.1');
  // Tagged after the rc and therefore nearer to HEAD in every sense that
  // `git describe` cares about.
  commit(dir, 'fix: late hotfix on the same line');
  git(dir, 'tag', 'v2.1.4');

  assert.equal(git(dir, 'describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*'), 'v2.1.4');
  assert.equal(selectGraduation(dir).tag, 'v3.0.0');
});

test('a final rc with zero commits after it still graduates', () => {
  const dir = repo();
  commit(dir, 'chore: init');
  git(dir, 'tag', 'v2.1.3');
  commit(dir, 'feat: everything');
  git(dir, 'tag', 'v3.0.0-rc.1');

  const g = selectGraduation(dir);
  assert.equal(g.tag, 'v3.0.0');
  assert.equal(g.base, 'v2.1.3');
});

test('an abandoned older train does not become a candidate', () => {
  const dir = repo();
  commit(dir, 'chore: init');
  git(dir, 'tag', 'v1.9.0');
  commit(dir, 'feat: the cycle that shipped as 2.0.0 instead');
  // v1.10.0-rc.* exist in this repository and v1.10.0 was never tagged.
  git(dir, 'tag', 'v1.10.0-rc.1');
  git(dir, 'tag', 'v1.10.0-rc.2');
  commit(dir, 'feat: later work');
  git(dir, 'tag', 'v2.1.3');
  commit(dir, 'feat: the real train');
  git(dir, 'tag', 'v3.0.0-rc.1');

  const g = selectGraduation(dir);
  assert.equal(g.tag, 'v3.0.0');
  assert.equal(g.base, 'v2.1.3');
});

test('an abandoned train alone is not graduated by accident', () => {
  const dir = repo();
  commit(dir, 'chore: init');
  git(dir, 'tag', 'v1.9.0');
  commit(dir, 'feat: abandoned');
  git(dir, 'tag', 'v1.10.0-rc.1');
  commit(dir, 'feat: later');
  git(dir, 'tag', 'v2.1.3');

  // v1.10.0 is ungraduated but below the stable line: releasing it now would
  // regress `latest`.
  assert.throws(() => selectGraduation(dir), ReleaseTrainError);
});

// ── Fail-closed states ───────────────────────────────────────────────────────

test('no rc at all fails closed', () => {
  const dir = repo();
  commit(dir, 'chore: init');
  git(dir, 'tag', 'v2.1.3');
  commit(dir, 'feat: unreleased work');

  assert.throws(() => selectGraduation(dir), ReleaseTrainError);
});

test('an rc that is not reachable from HEAD fails closed', () => {
  const dir = repo();
  commit(dir, 'chore: init');
  git(dir, 'tag', 'v2.1.3');
  git(dir, 'checkout', '-q', '-b', 'develop-2.2');
  commit(dir, 'feat: train work');
  git(dir, 'tag', 'v3.0.0-rc.1');
  git(dir, 'checkout', '-q', 'main');

  // Same repository, same tag — just not merged yet.
  assert.throws(() => selectGraduation(dir), ReleaseTrainError);
});

test('a malformed rc tag is not selected, and says so', () => {
  const dir = repo();
  commit(dir, 'chore: init');
  git(dir, 'tag', 'v2.1.3');
  commit(dir, 'feat: train work');
  for (const bad of ['v3.0.0-rc1', 'v3.0.0-rc.0', 'v3.0.0-rc.01', 'v3.0-rc.1']) {
    git(dir, 'tag', bad);
  }

  assert.throws(
    () => selectGraduation(dir),
    (err: unknown) =>
      err instanceof ReleaseTrainError && /do not match vX\.Y\.Z-rc\.N/.test(err.message)
  );
});

test('an already graduated train fails closed', () => {
  const dir = repo();
  commit(dir, 'chore: init');
  git(dir, 'tag', 'v2.1.3');
  commit(dir, 'feat: train work');
  git(dir, 'tag', 'v3.0.0-rc.1');
  git(dir, 'tag', 'v3.0.0');

  assert.throws(
    () => selectGraduation(dir),
    (err: unknown) =>
      err instanceof ReleaseTrainError && /Already graduated: v3\.0\.0/.test(err.message)
  );
});

test('two ungraduated trains above the stable line are ambiguous', () => {
  const dir = repo();
  commit(dir, 'chore: init');
  git(dir, 'tag', 'v2.1.3');
  commit(dir, 'feat: one train');
  git(dir, 'tag', 'v3.0.0-rc.1');
  commit(dir, 'feat: another train');
  git(dir, 'tag', 'v3.1.0-rc.1');

  assert.throws(
    () => selectGraduation(dir),
    (err: unknown) => err instanceof ReleaseTrainError && /Ambiguous/.test(err.message)
  );
});

test('a graduated train stops being a candidate, and the next one takes over', () => {
  const dir = repo();
  commit(dir, 'chore: init');
  git(dir, 'tag', 'v2.1.3');
  commit(dir, 'feat: first train');
  git(dir, 'tag', 'v3.0.0-rc.1');
  git(dir, 'tag', 'v3.0.0');
  commit(dir, 'feat: second train');
  git(dir, 'tag', 'v3.1.0-rc.1');

  const g = selectGraduation(dir);
  assert.equal(g.tag, 'v3.1.0');
  assert.equal(g.base, 'v3.0.0');
});

test('the very first release has no changelog base', () => {
  const dir = repo();
  commit(dir, 'feat: the beginning');
  git(dir, 'tag', 'v1.0.0-rc.1');

  const g = selectGraduation(dir);
  assert.equal(g.tag, 'v1.0.0');
  assert.equal(g.base, null);
});
