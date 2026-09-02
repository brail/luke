/**
 * Behavioral proof for `check-release-provenance.ts`.
 *
 * The gate decides whether an image is published and under which registry
 * tags, so "it has always been green" is not evidence it blocks anything. Each
 * case here materializes a throwaway repository with the branch topology the
 * release lifecycle actually has — a stable line, a release train branched off
 * it and carrying commits `main` does not have — places one tag, and asserts
 * the decision.
 *
 * Both directions matter equally. A gate that rejects a legitimate release is
 * discovered at the worst possible moment, with a tag already pushed, so the
 * accepted cases are asserted with the same weight as the rejected ones.
 *
 * Run: `pnpm test:tools`
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

import {
  ProvenanceError,
  checkReleaseProvenance,
  parseReleaseTag,
} from './check-release-provenance';

const created: string[] = [];

after(() => {
  for (const dir of created) rmSync(dir, { recursive: true, force: true });
});

interface Topology {
  repo: string;
  /** Tip of the stable line. */
  mainSha: string;
  /** A commit on the stable line, older than its tip. */
  mainOlderSha: string;
  /** Tip of the release train — reachable from the train, absent from main. */
  trainSha: string;
  /** A train commit that is not the tip, also absent from main. */
  trainOlderSha: string;
}

function git(repo: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd: repo,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

/**
 * The lifecycle's real shape: `develop-2.2` is cut from `main`, so every `main`
 * commit is an ancestor of the train. That is exactly why the rc rule needs its
 * negative half, and a fixture that branched the two independently would never
 * exercise it.
 */
function topology(): Topology {
  const repo = mkdtempSync(join(tmpdir(), 'luke-provenance-'));
  created.push(repo);

  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'config', 'user.email', 'gate@test.local');
  git(repo, 'config', 'user.name', 'gate');

  git(repo, 'commit', '-q', '--allow-empty', '-m', 'chore: root');
  const mainOlderSha = git(repo, 'rev-parse', 'HEAD');
  git(repo, 'commit', '-q', '--allow-empty', '-m', 'fix: stable hotfix');
  const mainSha = git(repo, 'rev-parse', 'HEAD');

  git(repo, 'checkout', '-q', '-b', 'develop-2.2');
  git(repo, 'commit', '-q', '--allow-empty', '-m', 'feat: train work');
  const trainOlderSha = git(repo, 'rev-parse', 'HEAD');
  git(repo, 'commit', '-q', '--allow-empty', '-m', 'feat: more train work');
  const trainSha = git(repo, 'rev-parse', 'HEAD');

  git(repo, 'checkout', '-q', 'main');

  return { repo, mainSha, mainOlderSha, trainSha, trainOlderSha };
}

function tagged(topo: Topology, tag: string, sha: string, expectedSha?: string) {
  git(topo.repo, 'tag', tag, sha);
  return checkReleaseProvenance({
    tag,
    repo: topo.repo,
    stableRef: 'main',
    trainRef: 'develop-2.2',
    expectedSha,
  });
}

function rejects(topo: Topology, tag: string, sha: string, expectedSha?: string) {
  assert.throws(
    () => tagged(topo, tag, sha, expectedSha),
    ProvenanceError,
    `expected ${tag} to be rejected`
  );
}

// ── The four provenance combinations ─────────────────────────────────────────

test('rc tag on a release-train commit is accepted as rc', () => {
  const topo = topology();
  const decision = tagged(topo, 'v2.2.0-rc.1', topo.trainSha);

  assert.equal(decision.channel, 'rc');
  assert.equal(decision.version, '2.2.0-rc.1');
  assert.equal(decision.sha, topo.trainSha);
});

test('rc tag on a commit that only exists on the stable line is rejected', () => {
  const topo = topology();
  // Reachable from develop-2.2 as well, since the train was cut from main —
  // one-sided reachability would wave this through.
  rejects(topo, 'v2.2.0-rc.1', topo.mainSha);
});

test('stable tag on a stable-line commit is accepted as stable', () => {
  const topo = topology();
  const decision = tagged(topo, 'v2.1.4', topo.mainSha);

  assert.equal(decision.channel, 'stable');
  assert.equal(decision.version, '2.1.4');
  assert.equal(decision.series, '2.1');
  assert.equal(decision.sha, topo.mainSha);
});

test('stable tag on a train-only commit is rejected', () => {
  const topo = topology();
  rejects(topo, 'v2.2.0', topo.trainSha);
});

// ── The channel/registry-tag contract ────────────────────────────────────────

test('an rc never enables latest or the minor series', () => {
  const topo = topology();
  const decision = tagged(topo, 'v2.2.0-rc.7', topo.trainSha);

  assert.equal(decision.publishLatest, false);
  assert.equal(decision.publishSeries, false);
  assert.equal(decision.publishRcLatest, true);
});

test('a stable release never enables rc-latest', () => {
  const topo = topology();
  const decision = tagged(topo, 'v2.1.4', topo.mainSha);

  assert.equal(decision.publishRcLatest, false);
  assert.equal(decision.publishLatest, true);
  assert.equal(decision.publishSeries, true);
});

// ── Tag shape ────────────────────────────────────────────────────────────────

test('tag shapes outside the two supported forms are rejected', () => {
  const topo = topology();

  // Every one of these matches the workflow's `v*` trigger, and every one of
  // them makes `docker/metadata-action`'s `type=semver` emit nothing at all —
  // an image pushed with no version tag and no red step.
  for (const tag of [
    'v2.2', // not three components
    'v2.2.0.1', // four
    'v2.2.0-rc1', // no separator
    'v2.2.0-rc.0', // the train starts at rc.1
    'v2.2.0-rc.01', // leading zero
    'v02.2.0', // leading zero
    'v2.2.0-beta.1', // unsupported prerelease identifier
    'v2.2.0-rc.1.2', // two prerelease counters
    'v2.2.0+build.5', // build metadata has no registry-tag meaning here
    '2.2.0', // no v
    'latest',
  ]) {
    rejects(topo, tag, topo.trainSha);
  }
});

test('parseReleaseTag classifies the two supported shapes and nothing else', () => {
  assert.deepEqual(parseReleaseTag('v2.1.4'), {
    channel: 'stable',
    version: '2.1.4',
    series: '2.1',
  });
  assert.deepEqual(parseReleaseTag('v10.0.0-rc.12'), {
    channel: 'rc',
    version: '10.0.0-rc.12',
    series: '10.0',
    rc: 12,
  });
  assert.equal(parseReleaseTag('v2.2.0-rc1'), null);
});

// ── Failing closed ───────────────────────────────────────────────────────────

test('a tag that is not in the checkout is rejected rather than assumed', () => {
  const topo = topology();

  assert.throws(
    () =>
      checkReleaseProvenance({
        tag: 'v2.2.0-rc.1',
        repo: topo.repo,
        stableRef: 'main',
        trainRef: 'develop-2.2',
      }),
    ProvenanceError
  );
});

test('an rc is rejected when the release train no longer exists', () => {
  const topo = topology();
  git(topo.repo, 'tag', 'v2.2.0-rc.1', topo.trainSha);

  assert.throws(
    () =>
      checkReleaseProvenance({
        tag: 'v2.2.0-rc.1',
        repo: topo.repo,
        stableRef: 'main',
        trainRef: 'develop-2.9',
      }),
    ProvenanceError
  );
});

test('an unresolvable stable ref is rejected even for an rc', () => {
  const topo = topology();
  git(topo.repo, 'tag', 'v2.2.0-rc.1', topo.trainSha);

  // Without `main` there is no way to prove the rc is *not* already stable, and
  // an unprovable claim must not pass.
  assert.throws(
    () =>
      checkReleaseProvenance({
        tag: 'v2.2.0-rc.1',
        repo: topo.repo,
        stableRef: 'origin/main',
        trainRef: 'develop-2.2',
      }),
    ProvenanceError
  );
});

test('a gate running on a different commit than the tag names is rejected', () => {
  const topo = topology();
  rejects(topo, 'v2.2.0-rc.1', topo.trainSha, topo.trainOlderSha);
});

test('the tag object of an annotated tag counts as the same commit', () => {
  const topo = topology();
  git(topo.repo, 'tag', '-a', 'v2.2.0-rc.3', topo.trainSha, '-m', 'rc');
  const tagObject = git(topo.repo, 'rev-parse', 'refs/tags/v2.2.0-rc.3');

  const decision = checkReleaseProvenance({
    tag: 'v2.2.0-rc.3',
    repo: topo.repo,
    stableRef: 'main',
    trainRef: 'develop-2.2',
    expectedSha: tagObject,
  });

  assert.equal(decision.sha, topo.trainSha);
});

// ── Lifecycle transitions ────────────────────────────────────────────────────

test('an older stable commit still qualifies for a stable tag', () => {
  const topo = topology();
  const decision = tagged(topo, 'v2.1.3', topo.mainOlderSha);

  assert.equal(decision.channel, 'stable');
});

test('the rc channel closes once the train has been merged into the stable line', () => {
  const topo = topology();
  git(topo.repo, 'merge', '-q', '--no-ff', '-m', 'chore: merge release train', 'develop-2.2');

  // Same commit, same tag shape, and now legitimately unpublishable as an rc:
  // it is on main, so it is released as a stable tag or not at all.
  rejects(topo, 'v2.2.0-rc.9', topo.trainSha);

  const decision = tagged(topo, 'v2.2.0', git(topo.repo, 'rev-parse', 'main'));
  assert.equal(decision.channel, 'stable');
});
