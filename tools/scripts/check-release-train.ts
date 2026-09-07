/**
 * Deterministic gate for an explicit release target: may *this* tag be prepared
 * *here*, and which commits are its release notes?
 *
 * ## Why the version is named rather than inferred
 *
 * `release-prepare.sh` used to ask `git-cliff --bumped-version` for the next
 * version. With no range git-cliff walks the whole history in **date order** and
 * closes a release every time that walk meets a tagged commit — and a position
 * in a date-ordered line is not a boundary in the commit graph. Once a stable
 * hotfix is merged into a release train, every train commit dated before it
 * falls on the published side of that boundary: the breaking changes among them
 * stop counting, and the answer comes back a patch bump for a range that
 * requires a major one. `topo_order` does not repair it — it sorts tags, and the
 * partition is still a line. An explicit `base..HEAD` is a set difference on the
 * graph, which is the question that was meant all along, and every
 * main-to-train synchronisation recreated the defect until it was asked.
 *
 * A second, independent defect sits underneath: the version git-cliff bumps
 * *from* is the newest-dated tag in the whole repository, reachable or not, and
 * it keeps one arbitrary name per tagged commit. An unmerged hotfix on `main`
 * became the base for the train; an annotated `-rc.3` sitting on the same commit
 * as a stable tag became the base instead of it.
 *
 * So the operator names the release and this module proves it, from facts git
 * can answer without consulting a single timestamp: reachability, version
 * precedence, and the commits in an explicit range.
 *
 * ## What it proves for `--validate vX.Y.Z[-rc.N]`
 *
 * - the tag does not exist anywhere yet, and the repository is a full clone;
 * - a stable tag `S` — the highest one reachable from HEAD — exists, and no
 *   stable tag anywhere outranks it (an unmerged hotfix must be merged first,
 *   or the release would silently skip it);
 * - at most one ungraduated release train is reachable, and the target belongs
 *   to it when there is one: a train has exactly one stable target, frozen when
 *   its first candidate is cut;
 * - the target is **not below the minimum bump** the conventional commits since
 *   `S` require. That minimum is git-cliff's own `bump_type` over `S..HEAD`,
 *   never a second Conventional Commit grammar written here;
 * - the range that will be rendered carries at least one commit.
 *
 * Equal to the minimum or above it is allowed: `feat!` since `S` forbids
 * `v2.1.5`, and permits `v3.0.0` and `v4.0.0` alike. There is no bypass flag —
 * CLAUDE.md keeps the Conventional Commits → SemVer mapping mandatory, and a
 * gate that can be waived on the day it is inconvenient is not a gate.
 *
 * A candidate after the first is the one case with no minimum: its target was
 * frozen when `rc.1` was cut, so only the counter moves. A breaking change
 * landing mid-train is therefore accepted into the next candidate and refused at
 * the graduation, where the minimum has become major and the frozen target is
 * below it — the train is then abandoned for a new one at the higher version.
 *
 * ## What it deliberately does not do
 *
 * It does not choose the version, it does not read the working tree, and it does
 * not check that the tree *claims* the version — that is
 * `check-release-tree.ts`, which `release-prepare.sh` runs on what it wrote and
 * `release.yml` runs on the tagged tree. Which git line a pushed tag may publish
 * from is `check-release-provenance.ts`, which also owns the tag grammar: this
 * module imports `parseReleaseTag` rather than restating it, so a tag it accepts
 * is by construction one that gate will admit.
 *
 * Usage:
 *   tsx tools/scripts/check-release-train.ts --validate v3.0.0-rc.1 [--repo .]
 *
 * Prints the values `release-prepare.sh` consumes — `kind=`, `version=`,
 * `range=`, `ignore=`, `min=`, `config=` — so the number, the section and the
 * manifests all come from this one answer. Regression-tested by
 * `check-release-train.test.ts` (`pnpm test:tools`).
 */

import { execFileSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';

import { ReleaseTag, parseReleaseTag } from './check-release-provenance';
import { REPO_ROOT } from './lib/report';

/**
 * Three numbers to order and to bump. `ReleaseTag` carries them, so a parsed
 * tag is one of these without conversion, and the result of a bump — a version
 * that has no tag yet — is one too.
 */
interface Semver {
  major: number;
  minor: number;
  patch: number;
}

/** The tag if it names a stable release, `null` for anything else. */
function asStableTag(tag: string): ReleaseTag | null {
  const parsed = parseReleaseTag(tag);
  return parsed !== null && parsed.channel === 'stable' ? parsed : null;
}

/** The tag if it names a release candidate, `null` for anything else. */
function asRcTag(tag: string): ReleaseTag | null {
  const parsed = parseReleaseTag(tag);
  return parsed !== null && parsed.channel === 'rc' ? parsed : null;
}

/**
 * Order by release precedence. The rc counter never participates: a candidate
 * is *at* its stable target, which is the version the train will publish and
 * therefore the one the minimum bump is compared against.
 */
function compare(a: Semver, b: Semver): number {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

/** `vX.Y.Z` — for a candidate, the stable target it belongs to. */
function formatStable(v: Semver): string {
  return `v${v.major}.${v.minor}.${v.patch}`;
}

/**
 * The tag a parsed release names, candidates included.
 *
 * `version` is built from the digits the grammar matched and leading zeroes are
 * rejected, so this round-trips exactly: no parsed tag needs to be carried
 * around beside its own name.
 */
function tagOf(v: ReleaseTag): string {
  return `v${v.version}`;
}

/** A rejection. Distinct type so tests assert on this module, not on any throw. */
export class ReleaseTrainError extends Error {}

function git(repo: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd: repo,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function tagList(repo: string, args: string[]): string[] {
  const out = git(repo, args);
  return out === '' ? [] : out.split('\n').map(t => t.trim());
}

/** Every tag in the repository, reachable or not. Collisions are repo-wide. */
function allTags(repo: string): string[] {
  return tagList(repo, ['tag', '--list', 'v*']);
}

/** Tags whose commit is an ancestor of HEAD. This is the release lineage. */
function reachableTags(repo: string): string[] {
  return tagList(repo, ['tag', '--merged', 'HEAD', '--list', 'v*']);
}

/** Highest stable release reachable from HEAD — the base every range starts at. */
function highestStable(tags: string[]): ReleaseTag | null {
  let best: ReleaseTag | null = null;
  for (const tag of tags) {
    const v = asStableTag(tag);
    if (v !== null && (best === null || compare(v, best) > 0)) best = v;
  }
  return best;
}

/**
 * The open release trains, one entry each: the highest-numbered candidate of a
 * train that is reachable and still ahead of the line.
 *
 * Outranking the highest reachable stable is the whole rule, and it is enough.
 * It is what keeps an abandoned train from being selected forever: this
 * repository has one, `v1.10.0-rc.1..15`, whose cycle shipped as `2.0.0`
 * instead, so `v1.10.0` will never be tagged.
 *
 * A graduated or superseded target never reaches that comparison, because the
 * caller has already established the stable base it is measured against: a
 * graduated tag that is reachable has raised `stable` to at least its own
 * version, and one that is not reachable was refused outright as a stable tag
 * this branch has not merged. Re-testing the target's existence here was
 * therefore dead — no reachable state observed it — and it is gone.
 *
 * Everything is decided from the reachable tag list the caller already read,
 * with no further git call.
 */
function ungraduatedTrains(reachable: string[], stable: Semver): ReleaseTag[] {
  const latest = new Map<string, ReleaseTag>();

  for (const tag of reachable) {
    const v = asRcTag(tag);
    if (v === null) continue;
    if (compare(v, stable) <= 0) continue;

    const target = formatStable(v);
    const best = latest.get(target);
    if (best === undefined || (v.rc ?? 0) > (best.rc ?? 0)) latest.set(target, v);
  }

  return [...latest.values()].sort((a, b) => compare(a, b));
}

// ── git-cliff, asked one question at a time ──────────────────────────────────

/**
 * The `--ignore-tags` value each kind of section is rendered with, and
 * therefore the one its emptiness must be judged under.
 *
 * A candidate's section ignores **every** tag, so the range produces one
 * heading even when a stable hotfix was merged into the train since the last
 * candidate. A graduation ignores the rc tags only: their boundaries are erased
 * so the whole train lands in one section, while a stable tag inside the range
 * would still split it — which is the sign of a base nobody meant.
 */
const IGNORE_FOR_RC = '.*';
const IGNORE_FOR_STABLE = '.*-rc\\..*';

/**
 * A cap, not an allocation. The context for this repository's current range is
 * ~750 KB of JSON, uncomfortably close to Node's 1 MiB default, and the default's
 * failure mode is an ENOBUFS thrown from a release gate whose message says
 * nothing about size.
 */
const MAX_BUFFER = 64 * 1024 * 1024;

const GIT_CLIFF = join(REPO_ROOT, 'node_modules', '.bin', 'git-cliff');

interface CliffRelease {
  /** `major` | `minor` | `patch`, and `null` when nothing releasable is in range. */
  bump_type: string | null;
  commits: unknown[];
}

/**
 * git-cliff's parsed view of one range, as JSON.
 *
 * Failure is decided by the exit status and by whether the output parses —
 * never by looking for words in stderr, where git-cliff also prints notices
 * such as its own update reminder.
 */
function readContext(
  repo: string,
  config: string,
  options: { range: string; ignore: string; bump: boolean }
): CliffRelease[] {
  const args = [
    '--repository',
    repo,
    '--config',
    config,
    '--ignore-tags',
    options.ignore,
  ];
  if (options.bump) args.push('--bump');
  args.push('--context', '--', options.range);

  let stdout: string;
  try {
    stdout = execFileSync(GIT_CLIFF, args, {
      encoding: 'utf-8',
      maxBuffer: MAX_BUFFER,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    const stderr = (err as { stderr?: unknown }).stderr;
    const detail =
      typeof stderr === 'string' && stderr.trim() !== ''
        ? stderr.trim().split('\n').slice(-2).join(' ')
        : (err as Error).message;
    throw new ReleaseTrainError(
      `git-cliff could not read ${options.range}: ${detail}`
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new ReleaseTrainError(
      `git-cliff did not return JSON for ${options.range}. Refusing to guess ` +
        'what it meant.'
    );
  }
  if (!Array.isArray(parsed)) {
    throw new ReleaseTrainError(
      `git-cliff returned ${typeof parsed} instead of a list of releases for ` +
        `${options.range}.`
    );
  }
  return parsed as CliffRelease[];
}

/**
 * The one release the range is supposed to describe.
 *
 * Two or more mean a tag git-cliff did not ignore sits inside the range, so the
 * base is not the boundary the caller believes it is — that is a rejection here,
 * because every later answer would be about a different release. **Zero** is not:
 * git-cliff returns no release at all for a range that resolves to nothing, and
 * an empty range is the same fact as a release with no commits. Both are
 * reported by `noReleasableCommit`, in one wording.
 */
function singleRelease(
  releases: CliffRelease[],
  range: string,
  base: string
): CliffRelease {
  if (releases.length === 1) return releases[0];
  if (releases.length === 0) return { bump_type: null, commits: [] };
  throw new ReleaseTrainError(
    `${range} contains ${releases.length - 1} tag(s) git-cliff treats as ` +
      `release boundaries, so ${base} is not the base of a single release. ` +
      'A tag inside the range is either a hotfix that belongs to the stable ' +
      'line or a tag nobody meant to create.'
  );
}

/**
 * One fact — this range publishes nothing — with one wording, whether it was
 * found while computing the minimum bump or while checking what will render.
 */
function noReleasableCommit(range: string): ReleaseTrainError {
  return new ReleaseTrainError(
    `${range} carries no releasable commit, so this release would publish ` +
      'empty notes. The range is either empty or holds only commits ' +
      '.cliff.toml skips.'
  );
}

/**
 * The lowest version this release may carry: the base bumped by git-cliff's own
 * verdict on the commits since it.
 *
 * The rc tags are ignored for this one question so the previous version
 * git-cliff resolves is always the stable base, whatever candidates exist in
 * between; `bump_type` itself is derived from the commits in the range, which
 * is why it stays correct even where git-cliff's own choice of previous does
 * not.
 */
function minimumVersion(
  repo: string,
  config: string,
  base: ReleaseTag
): Semver {
  if (base.major === 0) {
    throw new ReleaseTrainError(
      `the stable base ${tagOf(base)} is a 0.x version, whose bump rules this ` +
        'gate does not implement. Release 1.0.0 by hand first.'
    );
  }

  const range = `${tagOf(base)}..HEAD`;
  let releases: CliffRelease[];
  try {
    releases = readContext(repo, config, {
      range,
      ignore: IGNORE_FOR_STABLE,
      bump: true,
    });
  } catch (err) {
    // git-cliff keys tags by commit and keeps one name per commit, so when the
    // base commit also carries another release tag the ignore pattern can erase
    // the base itself and leave it with no previous version to bump from. It
    // usually copes — a graduated train's final candidate shares its commit
    // with the stable tag, which is the ordinary shape — so this is a
    // diagnosis for the failure, not a precondition of its own.
    const siblings = tagList(repo, [
      'tag',
      '--points-at',
      `refs/tags/${tagOf(base)}`,
    ]).filter(t => t !== tagOf(base) && parseReleaseTag(t) !== null);
    if (siblings.length > 0) {
      // A likely cause, not a certainty: git-cliff can fail here for reasons
      // that have nothing to do with the siblings, so the original message is
      // carried rather than replaced by a remedy that would not help.
      throw new ReleaseTrainError(
        `${err instanceof Error ? err.message : String(err)} — the base ` +
          `${tagOf(base)} shares its commit with ${siblings.join(', ')}, and ` +
          'git-cliff keeps only one tag per commit, so the base of the bump ' +
          'may be unresolvable. Tag the release commit alone.'
      );
    }
    throw err;
  }

  const release = singleRelease(releases, range, tagOf(base));
  const bump = release.bump_type;
  if (bump === null) throw noReleasableCommit(range);

  const { major, minor, patch } = base;
  switch (bump) {
    case 'major':
      return { major: major + 1, minor: 0, patch: 0 };
    case 'minor':
      return { major, minor: minor + 1, patch: 0 };
    case 'patch':
      return { major, minor, patch: patch + 1 };
    default:
      throw new ReleaseTrainError(
        `git-cliff reported the unknown bump type "${bump}" for ${range}.`
      );
  }
}

// ── The validation ───────────────────────────────────────────────────────────

export type TargetKind = 'rc-first' | 'rc-next' | 'stable';

export interface TargetValidation {
  kind: TargetKind;
  /** The tag as requested. */
  tag: string;
  /** The same without the `v`: what every manifest and heading must carry. */
  version: string;
  /** The tag the release notes start after. */
  base: string;
  /** `<base>..HEAD`, the range those notes cover. */
  range: string;
  /** The `--ignore-tags` value the notes must be rendered with. */
  ignore: string;
  /** The git-cliff configuration every answer here was computed under. */
  config: string;
  /** Lowest version the commits allow, or `null` for a frozen train target. */
  min: string | null;
}

function assertFullClone(repo: string): void {
  if (git(repo, ['rev-parse', '--is-shallow-repository']) !== 'false') {
    throw new ReleaseTrainError(
      'this is a shallow clone, so neither reachability nor the commits since ' +
        'the last release can be established. Fetch the full history.'
    );
  }
}

/** The configuration every git-cliff answer must be computed under. */
function cliffConfig(repo: string): string {
  const config = join(repo, '.cliff.toml');
  if (!existsSync(config)) {
    throw new ReleaseTrainError(
      `${config} does not exist. git-cliff would silently fall back to its own ` +
        'defaults and answer for a configuration this repository does not use.'
    );
  }
  return config;
}

function assertGitCliff(): void {
  if (!existsSync(GIT_CLIFF)) {
    throw new ReleaseTrainError(
      `${GIT_CLIFF} does not exist. Run \`pnpm install\` — the release gate ` +
        'reads the commits through git-cliff.'
    );
  }
}

/**
 * Validate an explicit release target against the topological release base.
 *
 * Every question is answered from tags and commit reachability. No timestamp is
 * read, and neither the working tree nor the index is consulted, so the verdict
 * for a given commit and tag set is the same on every machine.
 */
export function validateTarget(repo: string, tag: string): TargetValidation {
  assertFullClone(repo);
  const config = cliffConfig(repo);
  assertGitCliff();

  const requested = parseReleaseTag(tag);
  if (requested === null) {
    throw new ReleaseTrainError(
      `"${tag}" is not a release tag. Supported shapes: vX.Y.Z (stable) and ` +
        'vX.Y.Z-rc.N (release candidate, N >= 1, no leading zeroes).'
    );
  }

  const all = allTags(repo);
  if (all.includes(tag)) {
    throw new ReleaseTrainError(
      `${tag} already exists. A released version is never re-cut; prepare the ` +
        'next one.'
    );
  }

  const reachable = reachableTags(repo);
  const stable = highestStable(reachable);
  if (stable === null) {
    throw new ReleaseTrainError(
      'no stable tag is reachable from HEAD, so there is no base to release ' +
        'from. This gate prepares releases on an established line.'
    );
  }

  // A stable tag that outranks the base but is not reachable is a hotfix this
  // branch has not taken. Releasing over it would publish a version that
  // silently lacks published work — and, on the stable line, would regress it.
  for (const other of all) {
    const v = asStableTag(other);
    if (v !== null && compare(v, stable) > 0) {
      throw new ReleaseTrainError(
        `${other} exists but is not reachable from HEAD, so it outranks the ` +
          `base ${tagOf(stable)}. Merge the stable line first.`
      );
    }
  }

  const target = formatStable(requested);

  // Candidates for the very version being requested, sitting on a branch this
  // one has not merged: the train that owns this number is elsewhere.
  const strays = all.filter(other => {
    const v = asRcTag(other);
    return (
      v !== null && formatStable(v) === target && !reachable.includes(other)
    );
  });
  if (strays.length > 0) {
    throw new ReleaseTrainError(
      `${strays.join(', ')} exist but are not reachable from HEAD, so the ` +
        `train for ${target} is not this one. Merge it before releasing ${target}.`
    );
  }

  const trains = ungraduatedTrains(reachable, stable);
  if (trains.length > 1) {
    throw new ReleaseTrainError(
      `${trains.length} ungraduated trains are reachable ` +
        `(${trains.map(formatStable).join(', ')}). Graduate or abandon all ` +
        'but one before releasing; refusing to guess which one owns this tag.'
    );
  }
  const train = trains[0] ?? null;

  // One rule, one place: while a train is open it owns the next release, and
  // its target was frozen when its first candidate was cut.
  if (train !== null && formatStable(train) !== target) {
    throw new ReleaseTrainError(
      `the reachable release train targets ${formatStable(train)}, not ` +
        `${target}. A train has one stable target, frozen when its first ` +
        'candidate is cut: graduate it, or delete its candidates to abandon it.'
    );
  }

  // The one case with no minimum: the target is already fixed, so only the
  // counter is in question.
  const continuing = requested.channel === 'rc' && train !== null ? train : null;
  if (requested.channel === 'rc') {
    const expected = continuing === null ? 1 : (continuing.rc ?? 0) + 1;
    if (requested.rc !== expected) {
      throw new ReleaseTrainError(
        continuing === null
          ? `no candidate for ${target} is reachable from HEAD, so the first ` +
            `one is ${target}-rc.1, not ${tag}.`
          : `${tagOf(continuing)} is the latest candidate of this train, so ` +
            `the next one is ${target}-rc.${expected}, not ${tag}.`
      );
    }
  }

  const kind: TargetKind =
    requested.channel === 'stable'
      ? 'stable'
      : continuing === null
        ? 'rc-first'
        : 'rc-next';

  // A candidate starts after the previous one; a graduation starts at the
  // previous release, so the whole train lands in one section rather than the
  // final candidate's usually empty tail.
  const base = continuing === null ? tagOf(stable) : tagOf(continuing);
  const ignore =
    requested.channel === 'rc' ? IGNORE_FOR_RC : IGNORE_FOR_STABLE;
  const min = continuing === null ? minimumVersion(repo, config, stable) : null;

  if (min !== null && compare(requested, min) < 0) {
    throw new ReleaseTrainError(
      `${tag} is below ${formatStable(min)}, the minimum the commits since ` +
        `${tagOf(stable)} require. The Conventional Commits in that range are ` +
        'what decide it, and this gate has no override: release ' +
        `${formatStable(min)} or higher.`
    );
  }

  const range = `${base}..HEAD`;
  const release = singleRelease(
    readContext(repo, config, { range, ignore, bump: false }),
    range,
    base
  );
  if (release.commits.length === 0) throw noReleasableCommit(range);

  return {
    kind,
    tag,
    version: requested.version,
    base,
    range,
    ignore,
    config,
    min: min === null ? null : formatStable(min),
  };
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const value = process.argv[i + 1];
  if (value === undefined || value.startsWith('--') || value.trim() === '') {
    throw new ReleaseTrainError(`--${name} requires a value.`);
  }
  return value;
}

function main(): void {
  const tag = flag('validate');
  if (tag === undefined) {
    throw new ReleaseTrainError(
      'Nothing to do. Usage: --validate <vX.Y.Z|vX.Y.Z-rc.N> [--repo <path>]'
    );
  }

  const result = validateTarget(flag('repo') ?? process.cwd(), tag);

  // Exactly what release-prepare.sh consumes, key=value on their own lines so
  // the shell reads them without parsing prose. Anything it does not use is not
  // printed: an output nobody reads is a contract nobody maintains.
  console.log(`kind=${result.kind}`);
  console.log(`version=${result.version}`);
  console.log(`range=${result.range}`);
  console.log(`ignore=${result.ignore}`);
  console.log(`config=${result.config}`);
  console.log(`min=${result.min ?? ''}`);
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[release-train] REJECTED — ${message}`);
    process.exit(1);
  }
}
