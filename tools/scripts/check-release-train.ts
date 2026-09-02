/**
 * Which release candidate train a stable tag graduates, and what range its
 * changelog section must cover.
 *
 * ## Why it exists
 *
 * `release-prepare.sh` used `git describe --tags --abbrev=0` to find the train
 * it was graduating. `git describe` answers a different question: it returns
 * the *topologically nearest* tag, not the newest release. The lifecycle this
 * repository actually runs breaks that immediately — main takes a stable
 * hotfix while the train is in RC, the train is merged, and from the merge
 * commit the nearest tag is the hotfix. Reproduced: with v2.1.3, a v2.1.4
 * hotfix on main and v2.2.0-rc.1 on the train, `git describe` on the merge
 * returns v2.1.4, so `stable` mode refused ("not a release candidate") while
 * `auto`/`rc` proposed v2.2.0-rc.2 — an rc tag on main, which the provenance
 * gate then rejects. Every mode failed, on the only branch a stable tag may be
 * cut from.
 *
 * Reachability, not proximity, is the right question, and it is the same
 * question `check-release-provenance.ts` asks about the tagged commit.
 *
 * ## Selecting the train
 *
 * Among the rc tags reachable from HEAD, a train is a candidate when
 *
 * - its stable tag `vX.Y.Z` does not exist yet — anywhere, not merely
 *   reachable, since a graduated tag may live on another branch; and
 * - `vX.Y.Z` is greater than the highest stable tag reachable from HEAD.
 *
 * The second condition is what keeps an abandoned train from stealing the
 * selection. This repository has one: `v1.10.0-rc.1` through `rc.15` are
 * reachable and `v1.10.0` was never tagged, because that cycle shipped as
 * 2.0.0 instead. Without the comparison it would be a permanent candidate and
 * every graduation would be ambiguous forever.
 *
 * Exactly one candidate graduates. Zero and more-than-one both fail closed,
 * because the alternative is guessing which release the operator meant while
 * holding a tag that publishes `latest`.
 *
 * ## The changelog range
 *
 * `git-cliff --unreleased` starts at the last tag, and at graduation time the
 * last tag is the final rc — normally with no commits after it. That produced
 * a `## [X.Y.Z]` heading with nothing under it, which the old readiness check
 * accepted because it only looked for the heading. The stable section has to
 * carry the whole train, so the range starts at the previous *stable* release
 * and the rc tags inside it are erased with `--ignore-tags`; otherwise
 * git-cliff emits one section per rc tag it finds in the range.
 *
 * Starting at the previous stable release also excludes what that release
 * already published — a hotfix merged in from main is reachable from its own
 * tag, so `vX.Y.Z..HEAD` leaves it out rather than reprinting it.
 *
 * Usage:
 *   tsx tools/scripts/check-release-train.ts --graduate [--repo .]
 *
 * Prints `tag=` and `base=` lines for `release-prepare.sh`. Regression-tested
 * by `check-release-train.test.ts` (`pnpm test:tools`).
 */

import { execFileSync } from 'child_process';

/** A parsed `vX.Y.Z`, with the rc counter when the tag carried one. */
export interface Version {
  major: number;
  minor: number;
  patch: number;
  rc?: number;
}

/**
 * Deliberately the same two shapes `check-release-provenance.ts` accepts, and
 * for the same reason: a tag this module selects has to be one that gate will
 * later admit. Leading zeroes rejected, rc counter starts at 1.
 */
const STABLE = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const RC = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-rc\.([1-9]\d*)$/;

export function parseStable(tag: string): Version | null {
  const m = STABLE.exec(tag);
  if (m === null) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

export function parseRc(tag: string): Version | null {
  const m = RC.exec(tag);
  if (m === null) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    rc: Number(m[4]),
  };
}

/** Order by release precedence. The rc counter never participates. */
export function compare(a: Version, b: Version): number {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

export function formatStable(v: Version): string {
  return `v${v.major}.${v.minor}.${v.patch}`;
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

function reachableTags(repo: string): string[] {
  const out = git(repo, ['tag', '--merged', 'HEAD', '--list', 'v*']);
  return out === '' ? [] : out.split('\n').map(t => t.trim());
}

function tagExists(repo: string, tag: string): boolean {
  try {
    git(repo, ['rev-parse', '--verify', '--quiet', `refs/tags/${tag}`]);
    return true;
  } catch {
    return false;
  }
}

export interface Graduation {
  /** The stable tag to create, `vX.Y.Z`. */
  tag: string;
  /**
   * Tag the changelog range starts after, or `null` when this is the first
   * release and the range is the whole history.
   */
  base: string | null;
  /** The rc tags this train published, newest first — for the operator. */
  candidates: string[];
}

export function selectGraduation(repo: string): Graduation {
  const tags = reachableTags(repo);

  const stables = tags
    .map(t => ({ tag: t, v: parseStable(t) }))
    .filter((e): e is { tag: string; v: Version } => e.v !== null);

  const rcs = tags
    .map(t => ({ tag: t, v: parseRc(t) }))
    .filter((e): e is { tag: string; v: Version } => e.v !== null);

  if (rcs.length === 0) {
    // Surface near-misses: a tag that was meant to be an rc but does not match
    // the shape is invisible to selection, and silence here reads as "no train"
    // when the truth is "the train is misnamed".
    const nearMiss = tags.filter(t => /-rc/i.test(t) && parseRc(t) === null);
    throw new ReleaseTrainError(
      'No release candidate is reachable from HEAD, so there is no train to ' +
        'graduate.' +
        (nearMiss.length > 0
          ? ` Tags that look like candidates but do not match vX.Y.Z-rc.N: ${nearMiss.join(', ')}.`
          : '')
    );
  }

  const highestStable = stables
    .map(e => e.v)
    .reduce<Version | null>((hi, v) => (hi === null || compare(v, hi) > 0 ? v : hi), null);

  const targets = new Map<string, Version>();
  for (const rc of rcs) targets.set(formatStable(rc.v), rc.v);

  const candidates = [...targets.entries()].filter(([tag, v]) => {
    if (tagExists(repo, tag)) return false;
    return highestStable === null || compare(v, highestStable) > 0;
  });

  if (candidates.length === 0) {
    const graduated = [...targets.keys()].filter(t => tagExists(repo, t));
    throw new ReleaseTrainError(
      'No ungraduated release train above the current stable line.' +
        (highestStable !== null
          ? ` Highest reachable stable tag: ${formatStable(highestStable)}.`
          : '') +
        (graduated.length > 0 ? ` Already graduated: ${graduated.join(', ')}.` : '') +
        ' Nothing to graduate — cut a candidate first, or use the default mode.'
    );
  }

  if (candidates.length > 1) {
    throw new ReleaseTrainError(
      `Ambiguous: ${candidates.length} ungraduated trains are reachable ` +
        `(${candidates.map(([t]) => t).join(', ')}). Graduate or abandon all but ` +
        'one before releasing; refusing to guess which one publishes `latest`.'
    );
  }

  const [tag, version] = candidates[0];

  // The previous release, which is where this release's notes begin. Excluding
  // it by range is also what keeps a hotfix merged in from main out of these
  // notes: it is reachable from its own tag.
  const base = stables
    .filter(e => compare(e.v, version) < 0)
    .reduce<{ tag: string; v: Version } | null>(
      (hi, e) => (hi === null || compare(e.v, hi.v) > 0 ? e : hi),
      null
    );

  const trainRcs = rcs
    .filter(e => formatStable(e.v) === tag)
    .sort((a, b) => (b.v.rc ?? 0) - (a.v.rc ?? 0))
    .map(e => e.tag);

  return { tag, base: base === null ? null : base.tag, candidates: trainRcs };
}

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const value = process.argv[i + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new ReleaseTrainError(`--${name} requires a value.`);
  }
  return value;
}

function main(): void {
  if (!process.argv.includes('--graduate')) {
    throw new ReleaseTrainError('Nothing to do: pass --graduate.');
  }

  const result = selectGraduation(flag('repo') ?? process.cwd());

  // Consumed by release-prepare.sh. Key=value on their own lines so the shell
  // reads them without parsing prose.
  console.log(`tag=${result.tag}`);
  console.log(`base=${result.base ?? ''}`);
  console.log(`candidates=${result.candidates.join(',')}`);
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
