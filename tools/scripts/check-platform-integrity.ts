/**
 * Deterministic gate for the Luke platform: the invariants that hold the
 * approved technology stack together.
 *
 * ## Why it exists
 *
 * `.claude/skills/luke-deps/references/platform-policy.md` declares *where* each
 * platform fact lives. Prose can say a Node pin must match in five places; only
 * a script can prove it still does. Every invariant here was a rule that lived
 * as prose, as a shell one-liner in a skill, or as nothing at all — the same
 * promotion from control level 4 to level 2 that
 * `.claude/skills/luke-shared/audit-protocol.md` §3 asks for.
 *
 * ## What it is not
 *
 * Not a validator of pnpm's configuration model, nor of every property the
 * stack has. It encodes the invariants **Luke owns** and that are cheap and
 * unambiguous. A relationship the project does not actually own — the
 * OpenTelemetry version lines, say — is deliberately absent rather than
 * approximated, because a checker that reports correct architecture as broken
 * gets disabled within a week (`lessons.md`, "A new lint rule must be probed on
 * a bait file").
 *
 * The core is a pure function over a repository root so the fixtures under
 * `__fixtures__/platform/` can drive it against throwaway git repositories.
 */

import { execFileSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

import { formatProblems, REPO_ROOT, type Problem } from './lib/report';

// ---------------------------------------------------------------------------
// Luke policy constants
//
// These are project decisions, not observations about the tree. A version that
// appears here is one a manifest can never contradict — it is the value a
// manifest is held *against*. Current installed versions are never copied here.
// ---------------------------------------------------------------------------

/**
 * Approved supply-chain quarantine window, in minutes (72 hours).
 *
 * Measured on the declared pnpm: `pnpm install --frozen-lockfile` re-applies
 * this to every lockfile entry and fails with
 * `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`, so the policy governs CI too, not
 * only `pnpm update` resolution.
 */
const MINIMUM_RELEASE_AGE = 4320;

/**
 * Exclusion selectors measured to switch the quarantine off for every package
 * on the declared pnpm, rather than exempting a bounded set.
 *
 * `*` and `**` disable it outright. Bounded scope wildcards (`@scope/*`) are
 * legitimate and must keep passing: `@aws-sdk/*` exempted only that scope and
 * `@other/*` left the policy in force. The list is what was actually observed,
 * not a general glob-equivalence engine.
 */
const UNIVERSAL_EXCLUDE_SELECTORS = ['*', '**'];

/** Lockfiles from another package manager. pnpm is the only one (CLAUDE.md). */
const FOREIGN_LOCKFILES = [
  'package-lock.json',
  'yarn.lock',
  'npm-shrinkwrap.json',
];

/**
 * Where the approved Node major is pinned, and how to read it out of each file.
 *
 * Not a magic list: these are the `Node execution pins` row of the authority
 * table in `platform-policy.md`. The composite action exists precisely so a
 * Node bump is one edit instead of four — which only holds if something checks
 * that the five agree.
 */
const NODE_PIN_SITES: Array<{ file: string; extract: (text: string) => string | null }> = [
  { file: '.nvmrc', extract: t => t.trim().match(/^v?(\d+)/)?.[1] ?? null },
  {
    file: 'package.json',
    extract: t => JSON.parse(t).engines?.node?.match(/(\d+)/)?.[1] ?? null,
  },
  {
    file: '.github/actions/setup-workspace/action.yml',
    extract: t => t.match(/node-version:\s*'?(\d+)/)?.[1] ?? null,
  },
  {
    file: 'apps/api/Dockerfile',
    extract: t => t.match(/^FROM\s+node:(\d+)/m)?.[1] ?? null,
  },
  {
    file: 'apps/web/Dockerfile',
    extract: t => t.match(/^FROM\s+node:(\d+)/m)?.[1] ?? null,
  },
];

/** A set of packages whose majors must move together, and why. */
interface FamilyPolicy {
  name: string;
  members: string[];
  why: string;
}

/**
 * Families Luke actually owns a compatibility relationship for.
 *
 * Deliberately absent:
 * - `@opentelemetry/*` — spans 0.x experimental and 1.x/2.x stable lines at the
 *   same time, by upstream design. A same-major rule would report correct
 *   configuration as broken.
 * - `@types/react` / `@types/react-dom` — versioned independently of the
 *   runtime packages they describe.
 */
const DEPENDENCY_FAMILIES: FamilyPolicy[] = [
  {
    name: 'prisma',
    members: [
      'prisma',
      '@prisma/client',
      '@prisma/adapter-pg',
      '@prisma/instrumentation',
    ],
    why: 'client, CLI, adapter and instrumentation share a generated-client contract',
  },
  {
    name: 'trpc',
    members: ['@trpc/server', '@trpc/client', '@trpc/react-query'],
    why: 'wire format and router typing must agree across apps/api and apps/web',
  },
  {
    name: 'react',
    members: ['react', 'react-dom'],
    why: 'react-dom is built against a specific react runtime',
  },
];

/** Root scripts whose failure must reach the caller's exit status. */
const SECURITY_SCRIPTS = [
  'security',
  'security:sast',
  'security:secrets',
  'security:deps',
];

// ---------------------------------------------------------------------------
// Reading the repository
// ---------------------------------------------------------------------------

function read(root: string, file: string): string | null {
  const path = join(root, file);
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

/**
 * Tracked files matching a pathspec.
 *
 * git, not a filesystem walk: a checker must only make claims about what the
 * repo contains, or it passes locally and fails in CI (`lessons.md`,
 * "A checker that reads local state passes locally and fails in CI"). It also
 * keeps `node_modules` out without maintaining an ignore list.
 */
function tracked(root: string, pathspec: string): string[] {
  try {
    return execFileSync('git', ['ls-files', pathspec], {
      cwd: root,
      encoding: 'utf8',
    })
      .split('\n')
      .filter(Boolean);
  } catch {
    return [];
  }
}

interface Manifest {
  file: string;
  json: Record<string, unknown>;
}

function manifests(root: string): Manifest[] {
  return tracked(root, '*package.json')
    .map(file => {
      const text = read(root, file);
      if (text === null) return null;
      try {
        return { file, json: JSON.parse(text) as Record<string, unknown> };
      } catch {
        return null;
      }
    })
    .filter((m): m is Manifest => m !== null);
}

/** Every declared external dependency, as `name -> spec -> manifests`. */
function declaredDependencies(
  all: Manifest[]
): Map<string, Map<string, string[]>> {
  const byName = new Map<string, Map<string, string[]>>();

  for (const { file, json } of all) {
    const groups = [json.dependencies, json.devDependencies];
    for (const group of groups) {
      if (typeof group !== 'object' || group === null) continue;
      for (const [name, spec] of Object.entries(
        group as Record<string, string>
      )) {
        // Internal links carry no version to align.
        if (typeof spec !== 'string' || spec.startsWith('workspace:')) continue;
        const bySpec = byName.get(name) ?? new Map<string, string[]>();
        bySpec.set(spec, [...(bySpec.get(spec) ?? []), file]);
        byName.set(name, bySpec);
      }
    }
  }

  return byName;
}

/** Resolved packages in the lockfile, as `name -> versions`. */
function lockfilePackages(root: string): Map<string, Set<string>> {
  const text = read(root, 'pnpm-lock.yaml');
  const resolved = new Map<string, Set<string>>();
  if (text === null) return resolved;

  let inPackages = false;
  for (const line of text.split('\n')) {
    if (/^packages:\s*$/.test(line)) {
      inPackages = true;
      continue;
    }
    if (inPackages && /^\S/.test(line)) break;
    if (!inPackages) continue;

    const key = line.match(/^ {2}'?((?:@[^/'\s]+\/)?[^@'\s]+)@([^'\s:]+)'?:/);
    if (!key) continue;
    const [, name, version] = key;
    resolved.set(name, (resolved.get(name) ?? new Set()).add(version));
  }

  return resolved;
}

/** The major of a semver range, ignoring the range operator. */
function major(spec: string): string | null {
  return spec.match(/(\d+)\./)?.[1] ?? spec.match(/^\D*(\d+)$/)?.[1] ?? null;
}

// ---------------------------------------------------------------------------
// pnpm-workspace.yaml
//
// Parsed by hand rather than with a YAML library: no workspace declares one as
// a direct dependency, and reaching for a transitive copy would be a dependency
// this repo has not agreed to. Only the handful of top-level keys the policy
// covers are read, and every reader tolerates absence.
// ---------------------------------------------------------------------------

function scalar(yaml: string, key: string): string | null {
  return yaml.match(new RegExp(`^${key}:[ \\t]*(\\S.*?)\\s*$`, 'm'))?.[1] ?? null;
}

function sequence(yaml: string, key: string): string[] | null {
  const start = yaml.match(new RegExp(`^${key}:[ \\t]*$`, 'm'));
  if (start?.index === undefined) return null;
  const items: string[] = [];
  for (const line of yaml.slice(start.index).split('\n').slice(1)) {
    const item = line.match(/^[ \t]+-[ \t]+(.*?)\s*$/);
    if (!item) {
      if (/^\S/.test(line)) break;
      continue;
    }
    items.push(item[1].replace(/^['"]|['"]$/g, ''));
  }
  return items;
}

/** Split an exclusion selector into its package pattern and optional version. */
function splitSelector(selector: string): { pattern: string; version?: string } {
  const at = selector.lastIndexOf('@');
  if (at > 0) {
    return { pattern: selector.slice(0, at), version: selector.slice(at + 1) };
  }
  return { pattern: selector };
}

function patternMatches(pattern: string, name: string): boolean {
  if (!pattern.includes('*')) return pattern === name;
  const source = pattern
    .split('*')
    .map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('[^/]*');
  return new RegExp(`^${source}$`).test(name);
}

// ---------------------------------------------------------------------------
// Invariants
// ---------------------------------------------------------------------------

/** P1 — one version per external package across the workspace (CLAUDE.md rule 9). */
function checkVersionAlignment(all: Manifest[], problems: Problem[]): void {
  for (const [name, bySpec] of declaredDependencies(all)) {
    if (bySpec.size < 2) continue;
    const detail = [...bySpec]
      .map(([spec, files]) => `${spec} (${files.join(', ')})`)
      .join(' vs ');
    problems.push({
      file: 'package.json',
      line: 1,
      message:
        `\`${name}\` is declared at ${bySpec.size} different versions: ${detail}. ` +
        'One version per external package across the workspace (CLAUDE.md rule 9).',
    });
  }
}

/** P2 — the approved Node major agrees across every pin site. */
function checkNodePins(root: string, problems: Problem[]): void {
  const found = new Map<string, string>();

  for (const site of NODE_PIN_SITES) {
    const text = read(root, site.file);
    if (text === null) {
      problems.push({
        file: site.file,
        line: 1,
        message:
          'Node pin site is missing. `platform-policy.md` lists it as an ' +
          'authority for the approved Node major; if it moved, update the ' +
          'policy and this checker together.',
      });
      continue;
    }
    let value: string | null;
    try {
      value = site.extract(text);
    } catch {
      value = null;
    }
    if (value === null) {
      problems.push({
        file: site.file,
        line: 1,
        message: 'no Node version could be read from this pin site.',
      });
      continue;
    }
    found.set(site.file, value);
  }

  const distinct = new Set(found.values());
  if (distinct.size > 1) {
    const detail = [...found]
      .map(([file, value]) => `${file}=${value}`)
      .join(', ');
    problems.push({
      file: '.nvmrc',
      line: 1,
      message:
        `Node pin sites disagree: ${detail}. A missed pin does not fail — it ` +
        'silently runs a different Node somewhere.',
    });
  }
}

/** P3 — pnpm is the package manager, pinned exactly, with no rival lockfile. */
function checkPackageManager(root: string, problems: Problem[]): void {
  const text = read(root, 'package.json');
  if (text === null) return;
  const json = JSON.parse(text) as {
    packageManager?: string;
    engines?: { pnpm?: string };
  };

  const declared = json.packageManager;
  if (declared === undefined) {
    problems.push({
      file: 'package.json',
      line: 1,
      message:
        '`packageManager` is missing. Without it Corepack resolves whatever ' +
        'pnpm it likes, and a behavioral proof run in that shell describes a ' +
        'package manager the repo does not use.',
    });
  } else if (!/^pnpm@\d+\.\d+\.\d+\+sha512\.[0-9a-f]+$/.test(declared)) {
    problems.push({
      file: 'package.json',
      line: 1,
      message:
        `\`packageManager\` is \`${declared}\`: it must pin pnpm to an exact ` +
        'version with its integrity hash. Set it with `corepack use pnpm@<version>`, ' +
        'never by hand.',
    });
  }

  for (const lockfile of FOREIGN_LOCKFILES) {
    if (tracked(root, lockfile).length > 0) {
      problems.push({
        file: lockfile,
        line: 1,
        message:
          'a non-pnpm lockfile is tracked. pnpm is the only package manager ' +
          'for this repo (CLAUDE.md).',
      });
    }
  }

  // Only the `>=X` form is understood; anything else is left alone rather than
  // guessed at, so an unfamiliar range cannot invent a failure.
  const engine = json.engines?.pnpm;
  const floor = engine?.match(/^>=\s*(\d+)/)?.[1];
  const actual = declared?.match(/^pnpm@(\d+)/)?.[1];
  if (floor !== undefined && actual !== undefined && Number(actual) < Number(floor)) {
    problems.push({
      file: 'package.json',
      line: 1,
      message:
        `\`engines.pnpm\` requires >=${floor} but \`packageManager\` pins ` +
        `pnpm ${actual}.`,
    });
  }
}

/** P4 — the approved release-age quarantine is on, strict, and unbypassed. */
function checkReleaseAgePolicy(root: string, problems: Problem[]): void {
  const yaml = read(root, 'pnpm-workspace.yaml');
  if (yaml === null) {
    problems.push({
      file: 'pnpm-workspace.yaml',
      line: 1,
      message: 'missing: the workspace and its supply-chain policy live here.',
    });
    return;
  }

  // P4a — explicit quarantine.
  const age = scalar(yaml, 'minimumReleaseAge');
  if (age === null || Number(age) !== MINIMUM_RELEASE_AGE) {
    problems.push({
      file: 'pnpm-workspace.yaml',
      line: 1,
      message:
        `\`minimumReleaseAge\` must be \`${MINIMUM_RELEASE_AGE}\` (72h), found ` +
        `${age === null ? 'nothing' : `\`${age}\``}. Left unset it falls back ` +
        "to pnpm's built-in default, which cannot be read back from the " +
        'installed CLI — so nobody can state the cutoff the repo runs under.',
    });
  }

  // P4d — strict quarantine.
  const strict = scalar(yaml, 'minimumReleaseAgeStrict');
  if (strict !== 'true') {
    problems.push({
      file: 'pnpm-workspace.yaml',
      line: 1,
      message:
        '`minimumReleaseAgeStrict` must be `true`. With `false`, a range whose ' +
        'only match is younger than the window installs the immature version ' +
        'instead of failing (measured: ERR_PNPM_NO_MATURE_MATCHING_VERSION ' +
        'disappears).',
    });
  }

  // P4b — verification cannot be bypassed.
  if (scalar(yaml, 'trustLockfile') === 'true') {
    problems.push({
      file: 'pnpm-workspace.yaml',
      line: 1,
      message:
        '`trustLockfile` is enabled: it skips the supply-chain verification ' +
        'that re-applies the quarantine to every lockfile entry, which turns ' +
        'the whole policy off in one line.',
    });
  }

  // P4c — exclusions are bounded and current.
  const excludes = sequence(yaml, 'minimumReleaseAgeExclude') ?? [];
  const resolved = lockfilePackages(root);

  for (const selector of excludes) {
    if (UNIVERSAL_EXCLUDE_SELECTORS.includes(selector)) {
      problems.push({
        file: 'pnpm-workspace.yaml',
        line: 1,
        message:
          `\`${selector}\` exempts every package, which disables the quarantine ` +
          'entirely while looking like a narrow exception. A bounded scope ' +
          'wildcard such as `@scope/*` is fine.',
      });
      continue;
    }

    const { pattern, version } = splitSelector(selector);
    const names = [...resolved.keys()].filter(name =>
      patternMatches(pattern, name)
    );
    const matches =
      version === undefined
        ? names.length > 0
        : names.some(name => resolved.get(name)?.has(version));

    if (!matches) {
      problems.push({
        file: 'pnpm-workspace.yaml',
        line: 1,
        message:
          `\`${selector}\` matches nothing the lockfile currently resolves. ` +
          'An exception is added with the dependency that needs it, never ' +
          'ahead of one: a dormant entry reads as active policy.',
      });
    }
  }
}

/** P5 — packages that must move together are on the same major. */
function checkDependencyFamilies(all: Manifest[], problems: Problem[]): void {
  const declared = declaredDependencies(all);

  for (const family of DEPENDENCY_FAMILIES) {
    const majors = new Map<string, string>();
    for (const member of family.members) {
      const bySpec = declared.get(member);
      if (bySpec === undefined) continue;
      for (const spec of bySpec.keys()) {
        const m = major(spec);
        if (m !== null) majors.set(`${member}@${spec}`, m);
      }
    }

    if (new Set(majors.values()).size > 1) {
      const detail = [...majors]
        .map(([pkg, m]) => `${pkg} (major ${m})`)
        .join(', ');
      problems.push({
        file: 'package.json',
        line: 1,
        message:
          `the ${family.name} family is split across majors: ${detail}. ` +
          `${family.why}. Bump the family together, or the typecheck stays ` +
          'green over a version skew.',
      });
    }
  }
}

/**
 * P6 — the security runner keeps one of the approved canonical shapes.
 *
 * Luke's aggregate security scripts may be written two ways, and only two:
 *
 * 1. several blocking scanner invocations joined with `&&`; or
 * 2. delegation to a single dedicated runner, whose own exit status becomes the
 *    aggregate's.
 *
 * Anything else is rejected as non-canonical. That is a deliberately narrower
 * claim than "this script does not propagate failure", and the distinction
 * matters: `scanner || exit 1` *is* fail-closed, yet it is still rejected here,
 * because recognising every logically equivalent shell construction would mean
 * growing a Bash semantic parser inside a drift checker. The project picks two
 * shapes it can verify cheaply and treats departures from them as findings, not
 * as proofs of a defect.
 *
 * The original defect this guards — `dbe02ef`, a `;` between two Semgrep
 * invocations that discarded the first one's failure — cannot return while this
 * gate is green.
 */
function checkSecurityRunnerCanonicalForm(root: string, problems: Problem[]): void {
  const text = read(root, 'package.json');
  if (text === null) return;
  const scripts =
    ((JSON.parse(text) as { scripts?: Record<string, string> }).scripts ?? {});

  for (const name of SECURITY_SCRIPTS) {
    const script = scripts[name];
    if (script === undefined) continue;

    const nonCanonical = script
      .split(/&&/)
      .flatMap(part => [...part.matchAll(/(;|\|\|)/g)].map(m => m[1]));

    if (nonCanonical.length > 0) {
      problems.push({
        file: 'package.json',
        line: 1,
        message:
          `\`${name}\` joins commands with \`${nonCanonical[0]}\`, which is not ` +
          'one of the two approved shapes: scanners chained with `&&`, or a ' +
          'single runner whose own exit status is the script\'s. A `;` discards ' +
          "the preceding scanner's failure outright; `||` is rejected as " +
          'non-canonical rather than as proven fail-open.',
      });
    }
  }
}

// ---------------------------------------------------------------------------

/** Every platform invariant, against a repository root. */
export function checkPlatformIntegrity(root: string): Problem[] {
  const problems: Problem[] = [];
  const all = manifests(root);

  if (all.length === 0) {
    throw new Error(
      '[platform-integrity] no tracked package.json found. Either this is not ' +
        'a git repository or the manifests are untracked: every check below ' +
        'would pass without having read anything.'
    );
  }

  checkVersionAlignment(all, problems);
  checkNodePins(root, problems);
  checkPackageManager(root, problems);
  checkReleaseAgePolicy(root, problems);
  checkDependencyFamilies(all, problems);
  checkSecurityRunnerCanonicalForm(root, problems);

  return problems;
}

function main(): void {
  const problems = checkPlatformIntegrity(REPO_ROOT);

  if (problems.length > 0) {
    throw new Error(
      `[platform-integrity] ${problems.length} problemi:\n` +
        `${formatProblems(problems)}\n\n` +
        'Authority for each fact: .claude/skills/luke-deps/references/platform-policy.md'
    );
  }

  console.log(
    `[platform-integrity] ok — ${manifests(REPO_ROOT).length} manifest, ` +
      `${NODE_PIN_SITES.length} pin Node e ${DEPENDENCY_FAMILIES.length} ` +
      'famiglie di dipendenze verificate.'
  );
}

if (require.main === module) {
  main();
}
