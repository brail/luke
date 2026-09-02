/**
 * Deterministic gate for release provenance: which git line a version tag is
 * allowed to come from, and which registry tags that tag may therefore publish.
 *
 * ## Why it exists
 *
 * `release.yml` decided both questions with `contains(github.ref_name, '-rc')`.
 * That expression answers neither. It is a substring test on a string the
 * tagger chooses, so it says nothing about *where* the tagged commit lives: a
 * `v2.2.0` cut by mistake from the release-train branch published `latest` and
 * `2.2` from code that had never been on `main`, and every consumer pulling
 * `latest` moved onto it. It is also not a SemVer check — `v2.2` and
 * `v1.2.3-rc1` are not valid tags but pass `v*`, and `docker/metadata-action`'s
 * `type=semver` silently emits nothing for them, so the build would push an
 * image with no version tag at all and no step would go red.
 *
 * The gate replaces both halves with facts git can prove: the tag matches one
 * of exactly two shapes, and the commit it names is reachable from the branch
 * that shape belongs to.
 *
 * ## The two shapes
 *
 * - **stable** — `vX.Y.Z`, must be reachable from `main`.
 *   Publishes `X.Y.Z`, `X.Y` and `latest`. Never `rc-latest`.
 * - **rc** — `vX.Y.Z-rc.N` (N >= 1), must be reachable from the active
 *   release-train branch and *not yet* reachable from `main`.
 *   Publishes `X.Y.Z-rc.N` and `rc-latest`. Never `latest`, never `X.Y`.
 *
 * Anything else is rejected before an image is built.
 *
 * ## Why an RC also has to be absent from main
 *
 * `main` is an ancestor of the release train, so "reachable from the train" is
 * true for every commit on `main` as well — an RC tag placed on a `main`-only
 * commit would pass a one-sided check. The release train exists precisely to
 * hold what `main` does not have yet, so the negative half is what makes the
 * rc rule mean anything. It also expires the rc channel on its own: once the
 * train is merged, its commits are on `main` and no further rc tag on them is
 * accepted.
 *
 * ## What it does NOT establish
 *
 * Reachability is not authorship or review. Anyone who can push a tag can push
 * a branch, and this gate cannot tell a reviewed commit from an unreviewed one
 * — that is what branch protection is for. What it does guarantee is that a
 * published image's registry tags describe the line the code actually came
 * from, which is the property a `latest` consumer depends on.
 *
 * Usage:
 *   tsx tools/scripts/check-release-provenance.ts --tag v2.2.0-rc.1 \
 *     --stable-ref origin/main --train-ref origin/develop-2.2
 *   tsx tools/scripts/check-release-provenance.ts --shape-only --tag v2.2.0-rc.1
 *
 * Run by `release.yml` before any build job, and in `--shape-only` form by
 * `scripts/release-prepare.sh`, so the tag that script tells you to push is
 * checked against the same two shapes the gate will later accept — one
 * definition, not a regex copied into bash that drifts from this one.
 * Regression-tested by `check-release-provenance.test.ts` (`pnpm test:tools`).
 */

import { execFileSync } from 'child_process';
import { appendFileSync } from 'fs';

/** The two release lines. Nothing else can be published. */
export type ReleaseChannel = 'rc' | 'stable';

/** A tag name that matched one of the two supported shapes. */
export interface ReleaseTag {
  channel: ReleaseChannel;
  /** `X.Y.Z`, without the `v` and without the prerelease part. */
  version: string;
  /** `X.Y`, the moving minor-series tag. Only meaningful for `stable`. */
  series: string;
  /** The rc counter, present only on `rc`. */
  rc?: number;
}

/**
 * Strict, anchored, and deliberately narrower than SemVer.
 *
 * SemVer allows any prerelease identifier; this repository ships exactly one
 * (`rc.N`) and has done since v1.7.0-rc.1. Accepting `-beta.1` or `-rc1` here
 * would mean deciding at some later point what registry tags those publish,
 * and the answer would be invented under pressure during a release. Leading
 * zeroes are rejected the way SemVer rejects them, and `rc.0` with them: the
 * train starts at rc.1.
 */
const STABLE_TAG = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const RC_TAG = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-rc\.([1-9]\d*)$/;

/** Classify a tag name. `null` means "not a release tag" — the caller rejects. */
export function parseReleaseTag(tag: string): ReleaseTag | null {
  const stable = STABLE_TAG.exec(tag);
  if (stable) {
    const [, major, minor, patch] = stable;
    return {
      channel: 'stable',
      version: `${major}.${minor}.${patch}`,
      series: `${major}.${minor}`,
    };
  }

  const rc = RC_TAG.exec(tag);
  if (rc) {
    const [, major, minor, patch, counter] = rc;
    return {
      channel: 'rc',
      version: `${major}.${minor}.${patch}-rc.${counter}`,
      series: `${major}.${minor}`,
      rc: Number(counter),
    };
  }

  return null;
}

export interface ProvenanceInput {
  /** Tag name as pushed, e.g. `v2.2.0-rc.1`. */
  tag: string;
  /** Repository to resolve against. */
  repo: string;
  /** Revision naming the stable line, e.g. `origin/main`. */
  stableRef: string;
  /** Revision naming the active release train, e.g. `origin/develop-2.2`. */
  trainRef: string;
  /**
   * The SHA the workflow believes it checked out (`github.sha`). Compared
   * against the commit the tag actually resolves to, so a gate that ran on one
   * commit cannot authorize a build of another.
   *
   * Required, and required to look like a SHA. It was optional, and `flag()`
   * returns `''` rather than `undefined` for `--expected-sha ""`, so an empty
   * `$GITHUB_SHA` skipped the comparison entirely and the gate authorized
   * whatever commit the job happened to sit on. An unanswerable question must
   * reject, the same as an unresolvable stable ref.
   */
  expectedSha: string;
}

/** Everything the build jobs need, with no room left for them to re-derive it. */
export interface ProvenanceDecision {
  channel: ReleaseChannel;
  tag: string;
  version: string;
  series: string;
  sha: string;
  publishSeries: boolean;
  publishLatest: boolean;
  publishRcLatest: boolean;
}

/** A rejection. Distinct type so the tests assert on the gate, not on any throw. */
export class ProvenanceError extends Error {}

function git(repo: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd: repo,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

/** Resolve a revision to whatever object it names, or `null` when it has none. */
function resolveRev(repo: string, rev: string): string | null {
  try {
    return git(repo, ['rev-parse', '--verify', '--quiet', rev]);
  } catch {
    return null;
  }
}

/** Resolve a revision to a commit SHA, or `null` when it does not exist. */
function resolveCommit(repo: string, rev: string): string | null {
  return resolveRev(repo, `${rev}^{commit}`);
}

/**
 * `git merge-base --is-ancestor` exits 0 for yes and 1 for no, and anything
 * else is a real failure (a missing object, a broken repository). Collapsing
 * every non-zero exit to "no" would turn a broken checkout into a silent
 * rejection or, worse if the sense were inverted, a silent pass.
 */
function isAncestor(repo: string, sha: string, rev: string): boolean {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', sha, rev], {
      cwd: repo,
      stdio: 'ignore',
    });
    return true;
  } catch (err) {
    // execFileSync attaches the exit status to the thrown Error; the Node
    // types model it as `unknown`, so the shape has to be stated to read it.
    const status = (err as { status?: number }).status;
    if (status === 1) return false;
    throw new ProvenanceError(
      `git merge-base --is-ancestor ${sha} ${rev} failed with status ${String(status)}. ` +
        'The checkout is incomplete — provenance cannot be established.'
    );
  }
}

/** Full 40-char lowercase hex, which is what `github.sha` always is. */
const SHA = /^[0-9a-f]{40}$/;

export function checkReleaseProvenance(input: ProvenanceInput): ProvenanceDecision {
  const { tag, repo, stableRef, trainRef } = input;

  const expectedSha = input.expectedSha.trim();
  if (expectedSha === '') {
    throw new ProvenanceError(
      'No expected commit given. The gate must be told which commit the ' +
        'workflow is running on; it cannot assume it is the right one.'
    );
  }
  if (!SHA.test(expectedSha)) {
    throw new ProvenanceError(
      `"${input.expectedSha}" is not a commit SHA (expected 40 lowercase hex ` +
        'characters). Refusing to compare a tag against a value that cannot ' +
        'name a commit.'
    );
  }

  const parsed = parseReleaseTag(tag);
  if (parsed === null) {
    throw new ProvenanceError(
      `"${tag}" is not a release tag. Supported shapes: vX.Y.Z (stable, from ` +
        `${stableRef}) and vX.Y.Z-rc.N (release candidate, from ${trainRef}).`
    );
  }

  const sha = resolveCommit(repo, `refs/tags/${tag}`);
  if (sha === null) {
    throw new ProvenanceError(
      `Tag ${tag} does not resolve to a commit in this checkout. ` +
        'The workflow needs the tag fetched, not just its commit.'
    );
  }

  // An annotated tag has its own object; `github.sha` may name either it or the
  // commit it points at, depending on how the event was produced. Both are the
  // same tag, so both are accepted — anything else is a different commit.
  if (expectedSha !== sha && expectedSha !== resolveRev(repo, `refs/tags/${tag}`)) {
    throw new ProvenanceError(
      `Tag ${tag} resolves to ${sha} but the workflow is running on ` +
        `${expectedSha}. Refusing to authorize a build of a different commit.`
    );
  }

  const stableSha = resolveCommit(repo, stableRef);
  if (stableSha === null) {
    throw new ProvenanceError(
      `Cannot resolve ${stableRef}. Provenance is unprovable without the ` +
        'stable line fetched.'
    );
  }

  const onStable = isAncestor(repo, sha, stableRef);

  if (parsed.channel === 'stable') {
    if (!onStable) {
      throw new ProvenanceError(
        `${tag} is a stable tag but ${sha} is not reachable from ${stableRef}. ` +
          'Stable artifacts are cut from the stable line only — merge the ' +
          'release train first, then tag the merge.'
      );
    }

    return {
      channel: 'stable',
      tag,
      version: parsed.version,
      series: parsed.series,
      sha,
      publishSeries: true,
      publishLatest: true,
      publishRcLatest: false,
    };
  }

  if (trainRef === '') {
    throw new ProvenanceError(
      `${tag} is a release-candidate tag but no release-train ref was ` +
        'configured. Pass --train-ref or set LUKE_TRAIN_REF.'
    );
  }

  if (resolveCommit(repo, trainRef) === null) {
    throw new ProvenanceError(
      `${tag} is a release-candidate tag but ${trainRef} does not exist. ` +
        'An rc belongs to an active release train; there is none.'
    );
  }

  if (!isAncestor(repo, sha, trainRef)) {
    throw new ProvenanceError(
      `${tag} is a release-candidate tag but ${sha} is not reachable from ` +
        `${trainRef}. RC artifacts are cut from the active release train only.`
    );
  }

  if (onStable) {
    throw new ProvenanceError(
      `${tag} is a release-candidate tag but ${sha} is already reachable from ` +
        `${stableRef}. Code that has landed on the stable line is released as ` +
        'a stable tag, not as another candidate.'
    );
  }

  return {
    channel: 'rc',
    tag,
    version: parsed.version,
    series: parsed.series,
    sha,
    publishSeries: false,
    publishLatest: false,
    publishRcLatest: true,
  };
}

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return undefined;

  const value = process.argv[i + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new ProvenanceError(`--${name} requires a value.`);
  }
  return value;
}

function required(name: string): string {
  const value = flag(name);
  if (value === undefined || value === '') {
    throw new ProvenanceError(`--${name} is required.`);
  }
  return value;
}

/**
 * Every input arrives as an explicit flag, including the ones GitHub Actions
 * also exposes as environment variables. The workflow already knows all of
 * them, and reading `GITHUB_REF_NAME` or `GITHUB_SHA` behind the flags' backs
 * would give the gate a second, invisible way to be told which tag to
 * authorize — for a step whose entire job is to answer that question.
 */
function main(): void {
  const tag = required('tag');

  // Shape without provenance, for a tag that does not exist yet. `release-prepare`
  // asks this before printing the `git tag` line it hands the operator: a name
  // this rejects is a name the gate would reject after the push, which is the
  // expensive place to find out.
  if (process.argv.includes('--shape-only')) {
    const shape = parseReleaseTag(tag);
    if (shape === null) {
      throw new ProvenanceError(
        `"${tag}" is not a release tag. Supported shapes: vX.Y.Z and vX.Y.Z-rc.N.`
      );
    }
    console.log(shape.channel);
    return;
  }

  const decision = checkReleaseProvenance({
    tag,
    repo: flag('repo') ?? process.cwd(),
    stableRef: required('stable-ref'),
    trainRef: flag('train-ref') ?? '',
    expectedSha: required('expected-sha'),
  });

  const outputs: Record<string, string> = {
    channel: decision.channel,
    version: decision.version,
    series: decision.series,
    sha: decision.sha,
    publish_series: String(decision.publishSeries),
    publish_latest: String(decision.publishLatest),
    publish_rc_latest: String(decision.publishRcLatest),
  };

  const outputFile = flag('github-output');
  if (outputFile !== undefined && outputFile !== '') {
    appendFileSync(
      outputFile,
      Object.entries(outputs)
        .map(([k, v]) => `${k}=${v}\n`)
        .join('')
    );
  }

  console.log(
    `[release-provenance] ok — ${decision.tag} is a ${decision.channel} tag on ` +
      `${decision.sha}.\n` +
      `  publishes: ${decision.version}` +
      `${decision.publishSeries ? `, ${decision.series}` : ''}` +
      `${decision.publishLatest ? ', latest' : ''}` +
      `${decision.publishRcLatest ? ', rc-latest' : ''}`
  );
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[release-provenance] REJECTED — ${message}`);
    process.exit(1);
  }
}
