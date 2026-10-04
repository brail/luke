/**
 * Deterministic gate for the Luke platform: the invariants that hold the
 * approved technology stack together, plus the Prisma relation invariants of
 * CLAUDE.md rules 6 and 8 (P13), the Turbo own-build rule for emitting watch
 * tasks (P14), and the pnpm override hygiene of luke-deps §6 (P15).
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

import { validRange } from 'semver';

import { lockfilePackages as parseLockfilePackages } from './lib/pnpmLockfile';
import { mapping, scalar, sequence, splitSelector } from './lib/pnpmWorkspace';
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

/**
 * Workspaces that publish a built contract other workspaces compile against,
 * and must therefore never point a consumer back at their own sources.
 *
 * `apps/api` is here because `apps/web` and `scripts/rc-prod-clone.ts` import
 * `AppRouter` from it. While its manifest pointed `main`/`types` at
 * `./src/index.ts` those two programs each compiled 129 Fastify server files,
 * and because no `exports` map existed, `@luke/api/src/...` and
 * `@luke/api/dist/...` both answered — a package boundary that looked closed
 * and was not. `packages/core` is the precedent this rule generalises.
 *
 * Keyed by manifest path rather than package name so the fixtures can exercise
 * it without borrowing Luke's own package names.
 */
const PUBLISHED_CONTRACTS = ['apps/api/package.json', 'packages/core/package.json'] as const;

type PublishedContract = (typeof PUBLISHED_CONTRACTS)[number];

/**
 * The directory a published contract's entry points must resolve inside.
 *
 * Stated rather than merely "not `src`": an entry point at `./build/index.js`
 * is not source, but it is also not the tree `files` ships or the one the build
 * produces, and it passed a rule that only looked for `src`.
 */
const CONTRACT_DIST = 'dist';

/**
 * Paths the Web runtime image must never contain.
 *
 * The runner stage used to copy `apps/api/src` under a comment claiming tRPC
 * inference needed it at runtime. It did not: every `@luke/api` import in
 * `apps/web` is `import type` and erased at build time, and the image runs with
 * `apps/api` absent. A build-time dependency shipped into a runtime image is
 * how the source boundary quietly comes back.
 *
 * Matching is by containment, not by string equality: `COPY /app/apps/api`,
 * `COPY /app/apps` and `COPY /app` each put `apps/api/src` in the image without
 * ever naming it.
 */
const WEB_RUNTIME_FORBIDDEN = ['apps/api/src'] as const;

/**
 * Dependencies a package must declare because of what its **emitted
 * declarations** name, not because of what its source imports.
 *
 * `apps/api` has no `@prisma/client` import left: every Prisma type it uses
 * comes from `@luke/db`, and the runtime client is constructed there. What it
 * still has is a `dist/**.d.ts` graph that reaches `@prisma/client/runtime/client`
 * — `Decimal` and `JsonValue` travel out through the inferred tRPC router type
 * — and TypeScript resolves those specifiers from the file that names them, so
 * they resolve from `apps/api`. Dropping the declaration therefore breaks a
 * *different* package: measured, `apps/web`'s build went from clean to 88
 * errors, while `apps/api` itself stayed green in lint, tsc and every test.
 *
 * That is the whole reason this rule exists. An unused-looking devDependency is
 * exactly the kind of line a later cleanup removes, and nothing in the owning
 * package would report it.
 *
 * `devDependencies` and not `dependencies`: nothing in `apps/api` loads the
 * package at runtime, and the group is the declaration of that fact.
 */
const DECLARATION_GRAPH_DEPENDENCIES = [
  {
    file: 'apps/api/package.json',
    group: 'devDependencies',
    name: '@prisma/client',
    why:
      "its emitted `.d.ts` graph names `@prisma/client/runtime/client` (Decimal, JsonValue) " +
      "through the inferred AppRouter type, and TypeScript resolves that specifier from " +
      "apps/api. Without the declaration apps/web fails to build, while apps/api stays green.",
  },
] as const;

/**
 * The build that regenerates the Prisma client must delete the whole generated
 * tree first.
 *
 * `prisma generate` cleans only its own output root. Measured: a stale file
 * planted at `packages/db/src/generated/prisma/**` — the root itself and both
 * its subdirectories — is removed by the generator, but one planted a level up
 * at `packages/db/src/generated/` survives, and `tsc` then compiles it into
 * `dist` and ships it. That directory is gitignored as a whole, so nothing
 * else in the repository would ever mention the file: not git, not lint, not
 * a review. The only way it leaves is if the build removes the tree.
 *
 * Checked as an ordering, not just as containment: `prisma generate && rm -rf
 * src/generated` contains both strings and deletes the client it just wrote.
 */
const PRISMA_GENERATED_TREE = {
  file: 'packages/db/package.json',
  script: 'build',
  clean: 'rm -rf src/generated',
  generate: 'prisma generate',
} as const;

/**
 * The manifest, and the script in it, that must regenerate the Prisma client on
 * install.
 *
 * `@prisma/client` ships as a stub until `prisma generate` has run against a
 * schema. Without it a fresh clone cannot start: `pnpm install && pnpm dev`
 * died at `@luke/nav#build` with
 * `TS2305: Module '"@prisma/client"' has no exported member 'PrismaClient'`,
 * and no dev task ever started. CI and both Dockerfiles ran the step
 * explicitly, so every automated path was fine and only a human with a new
 * checkout hit it.
 *
 * A `postinstall` makes the development lifecycle self-sufficient rather than
 * documented, and this invariant is what stops it being dropped again.
 *
 * It has to be the **root** manifest. Measured on a full install: pnpm runs
 * lifecycle scripts for the root project (`. postinstall$ ...`) and for
 * dependencies, but not for workspace projects — the same hook on
 * `apps/api/package.json` never fired, and the fresh clone stayed broken.
 */
const PRISMA_GENERATE_SITE = {
  file: 'package.json',
  script: 'postinstall',
  must: 'prisma generate',
} as const;

/** The datamodel: `schema.prisma` for generator and datasource, one file per domain for the models. */
const PRISMA_SCHEMA_FILES = 'packages/db/prisma/*.prisma';

/** Turbo's task graph. */
const TURBO_CONFIG = 'turbo.json';

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
  return text === null ? new Map() : parseLockfilePackages(text);
}

/** The major of a semver range, ignoring the range operator. */
function major(spec: string): string | null {
  return spec.match(/(\d+)\./)?.[1] ?? spec.match(/^\D*(\d+)$/)?.[1] ?? null;
}

// ---------------------------------------------------------------------------
// pnpm-workspace.yaml
//
// Read through `lib/pnpmWorkspace.ts`, the hand-written parser shared with the
// documentation checker. Only the handful of top-level keys the policy covers
// are read, and every reader here tolerates absence.
// ---------------------------------------------------------------------------

/** Split an exclusion selector into its package pattern and optional version. */
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

/**
 * The Prisma client must be generated by installing, not by remembering to.
 *
 * See `PRISMA_GENERATE_SITE`. Checked as a script whose command contains the
 * generate call, so wrapping it (`prisma generate && something`) stays legal.
 */
function checkPrismaBootstrap(all: Manifest[], problems: Problem[]): void {
  const manifest = all.find(m => m.file === PRISMA_GENERATE_SITE.file);
  if (manifest === undefined) return;

  const scripts = (manifest.json.scripts ?? {}) as Record<string, unknown>;
  const script = scripts[PRISMA_GENERATE_SITE.script];

  if (typeof script !== 'string' || !script.includes(PRISMA_GENERATE_SITE.must)) {
    problems.push({
      file: PRISMA_GENERATE_SITE.file,
      line: 1,
      message:
        `\`${PRISMA_GENERATE_SITE.script}\` must run \`${PRISMA_GENERATE_SITE.must}\`. ` +
        '`@prisma/client` is a stub until it does, so without this a fresh ' +
        '`pnpm install && pnpm dev` fails at `@luke/nav#build` with TS2305 and ' +
        'no development task starts. CI and the Dockerfiles run it explicitly, ' +
        'which is why only a new checkout would find it broken.',
    });
  }
}

/**
 * A stale file in the generated tree must not survive a build.
 *
 * See `PRISMA_GENERATED_TREE`.
 */
function checkPrismaGeneratedTreeIsCleaned(all: Manifest[], problems: Problem[]): void {
  const manifest = all.find(m => m.file === PRISMA_GENERATED_TREE.file);
  if (manifest === undefined) {
    problems.push({
      file: PRISMA_GENERATED_TREE.file,
      line: 1,
      message:
        'is named in `PRISMA_GENERATED_TREE` but no such manifest is tracked. ' +
        'Either the package moved — update the entry — or the row is stale.',
    });
    return;
  }

  const scripts = (manifest.json.scripts ?? {}) as Record<string, unknown>;
  const script = scripts[PRISMA_GENERATED_TREE.script];

  const fail = (why: string): void => {
    problems.push({
      file: PRISMA_GENERATED_TREE.file,
      line: 1,
      message:
        `\`${PRISMA_GENERATED_TREE.script}\` ${why}. \`${PRISMA_GENERATED_TREE.generate}\` ` +
        'cleans only its own output root, so a file left a level up survives, is compiled into ' +
        '`dist` and ships — and the tree is gitignored, so nothing else would ever report it.',
    });
  };

  if (typeof script !== 'string') {
    fail('is missing');
    return;
  }

  const cleanAt = script.indexOf(PRISMA_GENERATED_TREE.clean);
  const generateAt = script.indexOf(PRISMA_GENERATED_TREE.generate);

  if (cleanAt === -1) {
    fail(`must run \`${PRISMA_GENERATED_TREE.clean}\``);
  } else if (generateAt === -1) {
    fail(`must run \`${PRISMA_GENERATED_TREE.generate}\``);
  } else if (cleanAt > generateAt) {
    fail(
      `must run \`${PRISMA_GENERATED_TREE.clean}\` *before* \`${PRISMA_GENERATED_TREE.generate}\`, ` +
        'not after — after, it deletes the client the build just wrote'
    );
  }
}

interface PrismaRelation {
  file: string;
  line: number;
  model: string;
  columns: string[];
  hasOnDelete: boolean;
  indexed: boolean;
}

/** Column names of a Prisma list (`[a, b(sort: Desc)]` → `['a', 'b']`). */
function prismaColumns(list: string): string[] {
  return list
    .split(',')
    .map(column => column.trim().replace(/\(.*$/, ''))
    .filter(Boolean);
}

/**
 * Every relation that owns a foreign key (`@relation(fields: [...])`), read textually from the tracked
 * schema files. `indexed` is true when an `@@index`, `@@unique`, `@@id`, field `@id` or field `@unique`
 * of the model leads with exactly the foreign-key columns — the only index Postgres can use for it.
 */
function prismaRelations(root: string): PrismaRelation[] {
  const relations: PrismaRelation[] = [];
  for (const file of tracked(root, PRISMA_SCHEMA_FILES)) {
    const text = read(root, file);
    if (text === null) continue;
    for (const model of text.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
      const [, name, rawBody] = model;
      // Line comments go first: a `// @@index([x])` or a trailing `// ... @unique` would otherwise
      // count as an index the database does not have. No string in the schema contains `//`.
      const body = rawBody.replace(/(^|\s)\/\/.*$/gm, '$1');
      // The body starts on the `model` line, so line i of the body is that line plus i.
      const firstLine = text.slice(0, model.index).split('\n').length;
      const lines = body.split('\n');
      // Both spellings Prisma accepts: `@@index([a])` and `@@index(fields: [a])`.
      const keys = [...body.matchAll(/@@(?:index|unique|id)\(\s*(?:fields:\s*)?\[([^\]]*)\]/g)].map(k =>
        prismaColumns(k[1])
      );
      for (const line of lines) {
        const field = /^\s*(\w+)\s+\S+(.*)$/.exec(line);
        if (field && /@(?:id|unique)\b/.test(field[2])) keys.push([field[1]]);
      }
      lines.forEach((line, i) => {
        const relation = /@relation\(([^)]*\bfields:\s*\[([^\]]*)\][^)]*)\)/.exec(line);
        if (!relation) return;
        const columns = prismaColumns(relation[2]);
        relations.push({
          file,
          line: firstLine + i,
          model: name,
          columns,
          hasOnDelete: /\bonDelete:/.test(relation[1]),
          indexed: keys.some(key => columns.every((column, j) => key[j] === column)),
        });
      });
    }
  }
  return relations;
}

/**
 * P13 — every relation declares `onDelete` and has an index its foreign key leads (CLAUDE.md rules 6
 * and 8).
 *
 * Postgres does not index a foreign key on its own. Without one, deleting the parent row scans the
 * child table to apply Restrict, SetNull or Cascade, and every filter on the column does the same:
 * sixteen relations had none until the rule was checked. A schema in which no relation is found is
 * reported, because the loop below would otherwise pass without having read anything.
 *
 * Known limits: the column order of a composite foreign key must match the index (every foreign key
 * is single-column today), and the no-relation guard covers the schema as a whole, not each file —
 * the relation count in the summary is how a file that stopped parsing shows up.
 */
function checkPrismaRelations(root: string, problems: Problem[]): void {
  const relations = prismaRelations(root);
  if (relations.length === 0) {
    problems.push({
      file: PRISMA_SCHEMA_FILES,
      line: 1,
      message:
        'No Prisma relation found: either the schema moved or the parser stopped matching it, ' +
        'and the relation rules below would pass without having read anything.',
    });
  }
  for (const { file, line, model, columns, hasOnDelete, indexed } of relations) {
    const fk = columns.join(', ');
    if (!hasOnDelete) {
      problems.push({
        file,
        line,
        message: `${model}: the relation on [${fk}] has no explicit \`onDelete\` (CLAUDE.md rule 6).`,
      });
    }
    if (!indexed) {
      problems.push({
        file,
        line,
        message:
          `${model}: no index leads with [${fk}]. Add \`@@index([${fk}])\` (CLAUDE.md rule 8): ` +
          'without it a delete of the parent row scans this table.',
      });
    }
  }
}

/** A script that writes build output while it watches: `tsc --watch` without `--noEmit`. */
function emitsWhileWatching(command: string): boolean {
  return /\btsc\b/.test(command) && /--watch\b/.test(command) && !/--noEmit\b/.test(command);
}

/**
 * P14 — a Turbo task that watches and emits depends on its own `build` (lessons.md, "A Turbo `dev`
 * task that emits must depend on its own `build`").
 *
 * `tsc --watch` writes into the same `dist` that a dependant's build deletes and rewrites: unless the
 * task waits for its own package's build, two writers race on that tree at cold start, and identical
 * output hides it. A package entry (`@pkg#task`) replaces the global one instead of merging with it,
 * so the entry checked is the one Turbo applies. A tree with no such script is reported, because the
 * loop would otherwise pass without having read anything.
 */
function checkEmittingWatchTasks(root: string, all: Manifest[], problems: Problem[]): void {
  const text = read(root, TURBO_CONFIG);
  let tasks: Record<string, { dependsOn?: unknown }>;
  try {
    tasks = (JSON.parse(text ?? '') as { tasks?: typeof tasks }).tasks ?? {};
  } catch {
    problems.push({ file: TURBO_CONFIG, line: 1, message: '`turbo.json` is missing or is not JSON, so the task graph cannot be checked.' });
    return;
  }
  const lineOf = (key: string): number => (text ?? '').split('\n').findIndex(l => l.includes(`"${key}"`)) + 1 || 1;

  let emitting = 0;
  for (const { file, json } of all) {
    const scripts = (json.scripts ?? {}) as Record<string, unknown>;
    for (const [script, command] of Object.entries(scripts)) {
      if (typeof command !== 'string' || !emitsWhileWatching(command)) continue;
      const own = `${String(json.name)}#${script}`;
      const key = own in tasks ? own : script;
      const task = tasks[key];
      if (task === undefined) continue; // Turbo never runs it, so it races with nothing.
      emitting++;
      const dependsOn = Array.isArray(task.dependsOn) ? task.dependsOn : [];
      if (!dependsOn.includes('build')) {
        problems.push({
          file: TURBO_CONFIG,
          line: lineOf(key),
          message:
            `\`${key}\` runs \`${script}\` of ${file} (\`${command}\`), which emits while it watches, ` +
            'but does not depend on its own `build`: at cold start it writes into the `dist` a ' +
            "dependant's build is deleting and rewriting. Add \"build\" to its dependsOn.",
        });
      }
    }
  }
  if (emitting === 0) {
    problems.push({
      file: TURBO_CONFIG,
      line: 1,
      message:
        'No Turbo task runs a `tsc --watch` that emits: either the dev scripts changed shape or the ' +
        'match stopped finding them, and this check would pass without having read anything.',
    });
  }
}

/**
 * A dependency required by an emitted declaration graph must stay declared.
 *
 * See `DECLARATION_GRAPH_DEPENDENCIES`. Fail-closed on the manifest too: a
 * classified path that stops being tracked is reported rather than skipped,
 * which is what keeps the rule from going quiet when a package is renamed.
 */
function checkDeclarationGraphDependencies(all: Manifest[], problems: Problem[]): void {
  for (const required of DECLARATION_GRAPH_DEPENDENCIES) {
    const manifest = all.find(m => m.file === required.file);
    if (manifest === undefined) {
      problems.push({
        file: required.file,
        line: 1,
        message:
          'is named in `DECLARATION_GRAPH_DEPENDENCIES` but no such manifest is tracked. ' +
          'Either the package moved — update the entry — or the row is stale.',
      });
      continue;
    }

    const group = manifest.json[required.group];
    const spec =
      typeof group === 'object' && group !== null
        ? (group as Record<string, unknown>)[required.name]
        : undefined;

    if (typeof spec !== 'string') {
      const elsewhere = ['dependencies', 'devDependencies'].find(other => {
        const entries = manifest.json[other];
        return typeof entries === 'object' && entries !== null && required.name in (entries as object);
      });
      problems.push({
        file: required.file,
        line: 1,
        message:
          `must declare \`${required.name}\` under \`${required.group}\`` +
          (elsewhere === undefined ? '' : `, not under \`${elsewhere}\``) +
          `: ${required.why}`,
      });
    }
  }
}

/**
 * A workspace that publishes a built contract must resolve to its build, and
 * publish nothing else.
 *
 * Four things, because each of the first three has a bypass the others miss:
 *
 * 1. every entry point — `main`, `types` and every string reachable in
 *    `exports` — resolves inside `dist/`. Rejecting only `src` let
 *    `./build/index.js` through, which is neither the tree `files` ships nor
 *    the one the build writes;
 * 2. an `exports` map exists, without which every path in the package answers,
 *    `src/` included;
 * 3. no `exports` **key** contains `*`. A wildcard subpath re-opens by pattern
 *    exactly what the map was added to close — `"./*": "./*"` republishes the
 *    whole package, sources included, while every declared target still looked
 *    legitimate to a rule that only inspected values;
 * 4. `files` lists `dist` and nothing under `src`. An empty array, or one
 *    naming only a README, is an allowlist that ships none of the contract;
 *    `["dist", "src"]` is one that ships the implementation beside it.
 *
 * `./package.json` is the single exempt target: it is deliberately published,
 * and it is not part of the built tree.
 *
 * The rule does not try to prove the targets exist — that is the build's job,
 * and `apps/api/test/module-contract.cjs` asserts it for real by resolving the
 * package through Node.
 */
function checkPublishedContracts(all: Manifest[], problems: Problem[]): void {
  for (const file of PUBLISHED_CONTRACTS) {
    const report = (message: string): void => {
      problems.push({ file, line: 1, message });
    };

    const manifest = contractManifest(all, file);
    if (manifest === undefined) {
      // Skipping would make the gate vacuous exactly when it matters: a
      // contract that has been renamed or untracked is one nothing checks.
      report(
        'is declared in `PUBLISHED_CONTRACTS` but no such manifest is tracked. ' +
          'Either the package moved — update the list — or it was removed and ' +
          'the entry is stale; a silent skip would leave the contract unguarded.'
      );
      continue;
    }

    const entryPoints: string[] = [];
    for (const key of ['main', 'types'] as const) {
      const value = manifest.json[key];
      if (typeof value === 'string') entryPoints.push(value);
    }

    // `exports: null` is not "no opinion": it removes the map, so every path in
    // the package resolves again. Only an absent key and an explicit map are
    // distinguishable states worth having, and one of them is a defect.
    if (manifest.json.exports === undefined || manifest.json.exports === null) {
      report(
        'publishes a built contract but declares no `exports` map. Without ' +
          'one every path inside the package resolves, `src/` included, so ' +
          'consumers can reach the implementation and its raw TypeScript ' +
          'through a boundary that looks closed.'
      );
    } else {
      entryPoints.push(...collectStrings(manifest.json.exports));

      for (const [key, value] of collectExportEntries(manifest.json.exports)) {
        // A wildcard that resolves to nothing is a *blocker*: `"./internal/*":
        // null` refuses a whole subtree, which draws the boundary rather than
        // widening it. Rejecting those was a false positive — the rule is about
        // publishing by pattern, so it fires only when the pattern has a target.
        if (key.includes('*') && collectStrings(value).length > 0) {
          report(
            `exports key \`${key}\` publishes by pattern. A wildcard subpath ` +
              'republishes whatever matches it, which is the boundary the map ' +
              'exists to draw; every published entry must be named explicitly. ' +
              '(A wildcard mapped to `null` blocks a subtree and is allowed.)'
          );
        }
      }
    }

    const files = manifest.json.files;
    if (!Array.isArray(files)) {
      report(
        'publishes a built contract but declares no `files` allowlist, so the ' +
          'package has no stated boundary between what it builds and what it ships.'
      );
    } else {
      const entries = files.filter((f): f is string => typeof f === 'string');
      if (!entries.some(f => pathSegments(f)[0] === CONTRACT_DIST)) {
        report(
          `\`files\` does not list \`${CONTRACT_DIST}\`, so the allowlist ships ` +
            'none of the tree the entry points resolve into.'
        );
      }
      for (const entry of entries) {
        const segments = pathSegments(entry);
        if (segments.includes('src')) {
          report(
            `\`files\` lists \`${entry}\`, shipping source beside the build. The ` +
              'allowlist is what stops the implementation being published; naming ' +
              '`src` in it defeats the entry-point rule below.'
          );
        }
        // npm resolves `files` as glob patterns, so a leading `*` or `**` is an
        // allowlist that allows the package. `dist/**` is fine — the glob is
        // bounded by a real first segment.
        if (segments.length > 0 && /[*?]/.test(segments[0])) {
          report(
            `\`files\` lists \`${entry}\`, whose first segment is a glob. That ` +
              'matches every top-level entry, `src` included, so the allowlist ' +
              'stops bounding anything.'
          );
        }
      }
    }

    for (const entry of entryPoints) {
      if (entry === './package.json') continue;
      const segments = pathSegments(entry);
      // `./dist/../src/index.ts` starts with `dist` and lands in `src`.
      // Normalising first is what makes the check about where the path *goes*
      // rather than how it is spelled.
      if (segments.includes('..')) {
        report(
          `entry point \`${entry}\` traverses out of its own directory with ` +
            '`..`. An entry point is a published location, not a route to one; ' +
            'resolve it and state it directly.'
        );
        continue;
      }
      if (segments[0] !== CONTRACT_DIST) {
        report(
          `entry point \`${entry}\` resolves outside \`${CONTRACT_DIST}/\`. A ` +
            'package consumed by another workspace must resolve to its build, or ' +
            "that workspace's TypeScript program silently compiles this one's " +
            'sources.'
        );
      }
    }
  }
}

/** Path split into segments, with `.`/`./` prefixes and empty parts removed. */
function pathSegments(value: string): string[] {
  return value.split('/').filter(part => part !== '' && part !== '.');
}

/**
 * Every subpath key declared in an `exports` value, paired with its target, at
 * any nesting depth.
 *
 * Condition names ("types", "import", "default") are not subpaths and cannot
 * carry a pattern, so only keys shaped like a subpath are returned.
 */
function collectExportEntries(value: unknown): Array<[string, unknown]> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return [];
  }
  const entries: Array<[string, unknown]> = [];
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (key === '.' || key.startsWith('./')) entries.push([key, nested]);
    entries.push(...collectExportEntries(nested));
  }
  return entries;
}

/**
 * The manifest for one declared contract.
 *
 * Takes `PublishedContract` rather than `string` so a caller cannot ask about a
 * workspace that is not on the list: the union derived from `PUBLISHED_CONTRACTS`
 * is what makes adding a contract a deliberate edit in one place instead of a
 * path typed twice and silently never matched.
 */
function contractManifest(
  all: Manifest[],
  file: PublishedContract
): Manifest | undefined {
  return all.find(m => m.file === file);
}

/** Every string reachable in a nested `exports` value, in declaration order. */
function collectStrings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(collectStrings);
  if (value !== null && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).flatMap(collectStrings);
  }
  return [];
}

/**
 * The Web runtime image must not carry API source.
 *
 * Reads only the runner stage — the builder legitimately holds the whole
 * repository, and needs API source to build the contract from. Stages are
 * delimited by `FROM`, and the runner is the last one, which is what the image
 * actually is.
 */
function checkWebRuntimeHasNoApiSource(root: string, problems: Problem[]): void {
  const file = 'apps/web/Dockerfile';
  const text = read(root, file);
  if (text === null) return;

  const stages = parseStages(joinContinuations(text));
  const workdirs = stageWorkdirs(stages);

  for (const stage of runtimeStages(stages)) {
    for (const line of stage.body.split('\n')) {
      if (!/^\s*COPY\b/i.test(line)) continue;

      for (const source of copySources(line, workdirs)) {
        for (const forbidden of WEB_RUNTIME_FORBIDDEN) {
          if (!overlaps(source, forbidden)) continue;

          problems.push({
            file,
            line: 1,
            message:
              `runtime stage \`${stage.name ?? '(unnamed)'}\` copies ` +
              `\`${source === '' ? '/' : source}\`, which overlaps \`${forbidden}\`. ` +
              'Every `@luke/api` import in apps/web is `import type` and erased ' +
              'at build time, so nothing in the image loads it: the copy ' +
              'reinstates a build-time dependency as a runtime one and puts ' +
              'server source in a public-facing container.',
          });
        }
      }
    }
  }
}

interface Stage {
  /** The `AS <name>` label, lowercased, or null for an unnamed stage. */
  name: string | null;
  /** Everything after the `FROM` line, up to the next one. */
  body: string;
}

/**
 * Folds `\`-continued Dockerfile lines into one logical line.
 *
 * A `COPY --from=builder \` split across three lines is a single instruction,
 * but read line by line the first has no operands and the rest do not start
 * with `COPY` — so a per-line reader saw no copy at all and passed.
 */
function joinContinuations(text: string): string {
  return text.replace(/\\[ \t]*\r?\n[ \t]*/g, ' ');
}

/** Splits a Dockerfile into its build stages. Instructions are case-insensitive. */
function parseStages(text: string): Stage[] {
  const stages: Stage[] = [];
  let current: Stage | null = null;

  for (const line of text.split('\n')) {
    const from = /^\s*FROM\s+\S+(?:\s+AS\s+(\S+))?\s*$/i.exec(line);
    if (from !== null) {
      current = { name: from[1]?.toLowerCase() ?? null, body: '' };
      stages.push(current);
      continue;
    }
    if (current !== null) current.body += `${line}\n`;
  }
  return stages;
}

/**
 * The stages that become the shipped image.
 *
 * The last stage is what `docker build` produces by default, but a Dockerfile
 * may declare stages after the runtime one — a debug or test target, say — and
 * checking only the last would then read the wrong stage entirely. Any stage
 * named `runner` is therefore examined as well.
 */
function runtimeStages(stages: Stage[]): Stage[] {
  const runtime = stages.filter(stage => stage.name === 'runner');
  const last = stages[stages.length - 1];
  if (last !== undefined && !runtime.includes(last)) runtime.push(last);
  return runtime;
}

/**
 * Every `WORKDIR` an image declares.
 *
 * Sources in a `COPY --from=` are absolute paths in the *builder's* filesystem,
 * so turning `/app/apps/api/src` into a repository path means stripping
 * whatever that builder's working directory is. Hardcoding `/app` made the rule
 * silently inert the moment somebody changed it.
 */
function stageWorkdirs(stages: Stage[]): string[] {
  const dirs = new Set<string>(['/app']);
  for (const stage of stages) {
    for (const line of stage.body.split('\n')) {
      const workdir = /^\s*WORKDIR\s+(\S+)\s*$/i.exec(line);
      if (workdir !== null && workdir[1].startsWith('/')) {
        dirs.add(workdir[1].replace(/\/+$/, ''));
      }
    }
  }
  // Longest first, so `/app/apps` is stripped before `/app` would half-match.
  return [...dirs].sort((a, b) => b.length - a.length);
}

/**
 * The source operands of a `COPY` instruction, normalised to repository-relative
 * paths.
 *
 * Handles both forms Docker accepts, in either order relative to the flags:
 * the exec form is whitespace-separated, and the JSON array form
 * (`COPY --from=builder ["src", "dest"]`) is what a path containing spaces has
 * to use. Reading the array as one opaque token let it through.
 */
function copySources(line: string, workdirs: string[]): string[] {
  let body = line.trim().replace(/^COPY\s*/i, '');

  // Flags precede the operands and may appear before either form.
  for (;;) {
    const flag = /^--[^\s]+\s*/.exec(body);
    if (flag === null) break;
    body = body.slice(flag[0].length);
  }

  const json = /^\[(.*)\]\s*$/.exec(body);
  const operands = (
    json === null
      ? body.split(/\s+/)
      : json[1].split(',').map(part => part.trim().replace(/^"|"$/g, ''))
  ).filter(token => token !== '' && !token.startsWith('--'));

  if (operands.length < 2) return [];

  return operands.slice(0, -1).map(operand => {
    let path = operand;
    for (const workdir of workdirs) {
      if (path === workdir || path.startsWith(`${workdir}/`)) {
        path = path.slice(workdir.length);
        break;
      }
    }
    path = path.replace(/^\.\//, '').replace(/^\//, '').replace(/\/+$/, '');
    // `COPY . .` in the runner copies the whole build context, `apps/api/src`
    // included. Left as `.` it compared equal to nothing.
    return path === '.' ? '' : path;
  });
}

/**
 * Whether a copy of `source` puts any part of `target` in the image.
 *
 * Containment both ways, which is the point. `COPY /app/apps/api` carries
 * `apps/api/src` with it; `COPY /app/apps/api/src/routers` carries part of it.
 * Only checking whether `source` is an ancestor accepted the second, which is
 * still API source in a runtime image. `''` is the build root and contains
 * everything.
 */
function overlaps(source: string, target: string): boolean {
  if (source === '') return true;
  return (
    source === target ||
    target.startsWith(`${source}/`) ||
    source.startsWith(`${target}/`)
  );
}

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// P10 — workspace dependency direction: a layer and runtime capability policy
// ---------------------------------------------------------------------------

type WorkspaceRuntime = 'universal' | 'node' | 'browser';

type WorkspaceRole =
  | { kind: 'tooling' }
  | { kind: 'layered'; layer: number; runtime: WorkspaceRuntime };

/**
 * The normative statement of who may depend on whom, independent of what any
 * manifest currently declares. Two attributes per workspace, not an edge list:
 *
 * - `layer` — a package may depend only on strictly lower layers. Same layer
 *   is forbidden (nav and calendar are peers, not a stack), and so is upward.
 * - `runtime` — a *runtime* dependency (`dependencies`) must be `universal`
 *   or share the dependant's runtime. `devDependencies` are type/tooling edges
 *   and cross runtimes freely, which is how `apps/web` consumes `@luke/api`
 *   for `AppRouter` without ever loading Fastify in a browser bundle.
 *
 * `tooling` manifests (the repository root, the ESLint plugin) may name a
 * workspace only under `devDependencies`.
 *
 * Only `dependencies` and `devDependencies` carry a workspace edge. A
 * workspace under `peerDependencies` or `optionalDependencies` is reported
 * rather than judged: neither group has a meaning here today (no manifest
 * uses either), so the policy fails closed instead of guessing one.
 *
 * Every workspace edge must use the `workspace:` protocol. A semver range on
 * a name that also exists in the tree lets pnpm satisfy it from the registry
 * one day, silently replacing the tree's package with a published stranger.
 *
 * Fail-closed in both directions: every tracked manifest must be classified,
 * and every classified path must be tracked. The ESLint rule
 * `@luke/no-undeclared-workspace-import` guarantees imports ⊆ declarations;
 * this check guarantees declarations ⊆ policy. Together: imports ⊆ policy,
 * even when the importing package edits its own manifest — measured: with
 * `@luke/api` added to core's manifest, the rule, lint, tsc and every other
 * gate passed, and only this check refused the edge.
 */
const WORKSPACE_POLICY = {
  'package.json': { kind: 'tooling' },
  'packages/eslint-plugin-luke/package.json': { kind: 'tooling' },
  'packages/core/package.json': { kind: 'layered', layer: 0, runtime: 'universal' },
  // Layer 0 beside `@luke/core`, not above it: `@luke/db` depends on no
  // workspace at all, and both its consumers — `@luke/nav` at layer 1 and
  // `apps/api` at layer 2 — must be able to reach it. Same layer as core means
  // neither may depend on the other, which is the point: core ships to the
  // browser and must never pull a database client into a bundle, and the
  // generated Prisma client has no use for core's schemas.
  'packages/db/package.json': { kind: 'layered', layer: 0, runtime: 'node' },
  'packages/nav/package.json': { kind: 'layered', layer: 1, runtime: 'node' },
  'packages/calendar/package.json': { kind: 'layered', layer: 1, runtime: 'node' },
  'apps/api/package.json': { kind: 'layered', layer: 2, runtime: 'node' },
  'apps/web/package.json': { kind: 'layered', layer: 3, runtime: 'browser' },
} as const satisfies Record<string, WorkspaceRole>;

const WORKSPACE_EDGE_GROUPS = ['dependencies', 'devDependencies'] as const;
const UNSUPPORTED_EDGE_GROUPS = ['peerDependencies', 'optionalDependencies'] as const;

function workspaceRole(file: string): WorkspaceRole | undefined {
  return (WORKSPACE_POLICY as Record<string, WorkspaceRole>)[file];
}

function describeRole(role: WorkspaceRole): string {
  return role.kind === 'tooling' ? 'tooling' : `layer ${role.layer}, ${role.runtime}`;
}

function checkWorkspaceDependencyDirection(all: Manifest[], problems: Problem[]): void {
  // Package identity fails closed: a workspace edge is a `name` in another
  // manifest, so a classified manifest with no name can neither be depended
  // on nor have its own edges attributed, and two manifests sharing a name
  // would let either answer for the other. Every manifest carrying a shared
  // name is reported, and the name resolves no edge at all — an edge to it
  // is then reported as unresolvable rather than attributed to whichever
  // manifest `git ls-files` listed first.
  const named = new Map<string, Manifest[]>();
  for (const manifest of all) {
    const name = manifest.json.name;
    if (typeof name === 'string' && name.length > 0) {
      named.set(name, [...(named.get(name) ?? []), manifest]);
    } else if (workspaceRole(manifest.file) !== undefined) {
      problems.push({
        file: manifest.file,
        line: 1,
        message:
          'is classified in `WORKSPACE_POLICY` but has no `name`. A workspace edge is a name in ' +
          'another manifest, so an unnamed package can neither be depended on nor be judged.',
      });
    }
  }
  const byName = new Map<string, Manifest>();
  for (const [name, holders] of named) {
    if (holders.length === 1) {
      byName.set(name, holders[0]);
      continue;
    }
    for (const manifest of holders) {
      const others = holders.filter(h => h !== manifest).map(h => h.file).join(', ');
      problems.push({
        file: manifest.file,
        line: 1,
        message:
          `has the name \`${name}\`, which is also the name of ${others}. Two manifests with one ` +
          'name let either answer for a declared edge; names must be unique across tracked manifests, ' +
          'and until they are this name resolves no edge.',
      });
    }
  }

  const trackedFiles = new Set(all.map(m => m.file));
  for (const file of Object.keys(WORKSPACE_POLICY)) {
    if (!trackedFiles.has(file)) {
      problems.push({
        file,
        line: 1,
        message:
          'is classified in `WORKSPACE_POLICY` but no such manifest is tracked. ' +
          'Either the package moved — update the entry — or it was removed and the row is stale.',
      });
    }
  }

  for (const manifest of all) {
    const report = (message: string): void => {
      problems.push({ file: manifest.file, line: 1, message });
    };
    const role = workspaceRole(manifest.file);
    if (role === undefined) {
      report(
        'is a tracked manifest with no row in `WORKSPACE_POLICY`. Every workspace must ' +
          'state its layer and runtime (or be `tooling`) before anything may depend on it, or it on anything.'
      );
      continue;
    }

    for (const group of UNSUPPORTED_EDGE_GROUPS) {
      const entries = manifest.json[group];
      if (typeof entries !== 'object' || entries === null) continue;
      for (const [name, spec] of Object.entries(entries as Record<string, unknown>)) {
        const isWorkspaceSpec = typeof spec === 'string' && spec.startsWith('workspace:');
        if (byName.has(name) || isWorkspaceSpec) {
          report(
            `declares workspace package \`${name}\` under \`${group}\`. The policy judges only ` +
              '`dependencies` (runtime) and `devDependencies` (types/tooling); this group has no ' +
              'meaning for a workspace edge here, so it is refused rather than guessed.'
          );
        }
      }
    }

    const seen = new Map<string, string[]>();

    for (const group of WORKSPACE_EDGE_GROUPS) {
      const entries = manifest.json[group];
      if (typeof entries !== 'object' || entries === null) continue;
      for (const [name, spec] of Object.entries(entries as Record<string, unknown>)) {
        const target = byName.get(name);
        const isWorkspaceSpec = typeof spec === 'string' && spec.startsWith('workspace:');
        if (target === undefined) {
          if (isWorkspaceSpec) {
            report(
              `declares \`${name}\` as a workspace dependency, but no single tracked manifest has that name ` +
                '(none does, or more than one does). A workspace link that resolves to nothing is a ' +
                'declaration the policy cannot judge.'
            );
          }
          continue; // an external package is not this check's business
        }
        if (!isWorkspaceSpec) {
          report(
            `declares \`${name}\` — a tracked workspace — with the spec \`${String(spec)}\` instead of the ` +
              '`workspace:` protocol. Anything else can one day be satisfied from the registry by a ' +
              'published package of the same name, silently replacing the tree\'s.'
          );
        }
        seen.set(name, [...(seen.get(name) ?? []), group]);

        if (target.file === manifest.file) {
          report(`declares itself (\`${name}\`) as a dependency. A package cannot depend on its own contract.`);
          continue;
        }

        const targetRole = workspaceRole(target.file);
        if (targetRole === undefined) continue; // already reported on the target itself

        if (role.kind === 'tooling') {
          if (group !== 'devDependencies') {
            report(
              `is tooling but declares \`${name}\` under \`${group}\`. Tooling manifests may name a ` +
                'workspace only under `devDependencies`: they consume types and scripts, never a runtime.'
            );
          }
          continue;
        }

        if (targetRole.kind === 'tooling') {
          if (group !== 'devDependencies') {
            report(`declares tooling package \`${name}\` under \`${group}\`; tooling is a devDependency or nothing.`);
          }
          continue;
        }

        if (targetRole.layer >= role.layer) {
          report(
            `(${describeRole(role)}) declares \`${name}\` (${describeRole(targetRole)}) under \`${group}\`. ` +
              'A workspace may depend only on strictly lower layers: this edge points ' +
              (targetRole.layer === role.layer ? 'sideways' : 'upward') +
              ' and is forbidden by `WORKSPACE_POLICY` whether or not anything imports it yet.'
          );
          continue;
        }

        if (group === 'dependencies' && targetRole.runtime !== 'universal' && targetRole.runtime !== role.runtime) {
          report(
            `(${role.runtime}) declares \`${name}\` (${targetRole.runtime}) as a runtime dependency. ` +
              'A runtime edge may reach only a universal package or one sharing this runtime. If only ' +
              'its types are needed, move it to `devDependencies`, which the ESLint rule then limits to `import type`.'
          );
        }
      }
    }

    for (const [name, where] of seen) {
      if (where.length > 1) {
        report(
          `declares \`${name}\` under both \`dependencies\` and \`devDependencies\`. One of them is the ` +
            'contract; the other silently widens it.'
        );
      }
    }
  }
}

/** A complete advisory id: a GitHub one, or a CVE. */
const ADVISORY_ID = /\bGHSA(?:-[23456789cfghjmpqrvwx]{4}){3}\b|\bCVE-\d{4}-\d{4,}\b/;

/** An exact version, in any spelling pnpm accepts as one. */
const EXACT_VERSION = /^=?v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/**
 * P15 — no pnpm override pins an exact version, and each names the advisory it
 * answers (luke-deps §6). An exact pin keeps forcing its version after the next
 * patch ships, and `pnpm update` cannot outrank it; an override without an
 * advisory id is one nobody can tell when to retire. The id shows what an entry
 * was written for, not that lifting a consumer past its own range was right —
 * that stays a reviewer's call. A form the reader does not understand is refused
 * rather than read as fewer overrides; so are a parent selector (`a>b`), a value
 * that is not a version range (an alias, a dist-tag, a removal, a reference), two
 * overrides of one package (pnpm applies only one to a consumer), and overrides
 * declared in the root manifest, none of which the override checks model.
 */
function checkOverrides(root: string, all: Manifest[], problems: Problem[]): void {
  const rootManifest = all.find(m => m.file === 'package.json')?.json;
  const pnpmField = rootManifest?.pnpm;
  const elsewhere = {
    resolutions: rootManifest?.resolutions,
    'pnpm.overrides':
      typeof pnpmField === 'object' && pnpmField !== null && 'overrides' in pnpmField
        ? pnpmField.overrides
        : undefined,
  };
  for (const [field, declared] of Object.entries(elsewhere)) {
    if (declared !== undefined) {
      problems.push({
        file: 'package.json',
        line: 1,
        message:
          `\`${field}\` overrides dependencies outside \`pnpm-workspace.yaml\`, where the override ` +
          'checks do not look: move them into its `overrides` block.',
      });
    }
  }

  const yaml = read(root, 'pnpm-workspace.yaml');
  if (yaml === null) return; // P4 already reports the missing file.

  let entries;
  try {
    entries = mapping(yaml, 'overrides');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    problems.push({ file: 'pnpm-workspace.yaml', line: 1, message });
    return;
  }

  const firstOverride = new Map<string, string>();
  for (const { key, value, line, comment } of entries ?? []) {
    const at = { file: 'pnpm-workspace.yaml', line };
    const pkg = splitSelector(key).pattern;
    const earlier = firstOverride.get(pkg);
    if (earlier !== undefined) {
      problems.push({
        ...at,
        message:
          `\`${key}\` overrides \`${pkg}\` again (after \`${earlier}\`): pnpm applies one of them ` +
          'to each consumer, which the override checks do not model. Merge them into one entry.',
      });
    }
    firstOverride.set(pkg, earlier ?? key);
    if (key.includes('>')) {
      problems.push({
        ...at,
        message:
          `\`${key}\` uses a parent selector, which the override checks do not model: ` +
          'override the package itself.',
      });
    }
    if (validRange(value) === null) {
      problems.push({
        ...at,
        message:
          `\`${key}\`: \`${value}\` is not a version range (an alias, a dist-tag, a removal or a ` +
          'reference), which the override checks do not model. Write a range from the fixed version.',
      });
    } else if (EXACT_VERSION.test(value)) {
      problems.push({
        ...at,
        message:
          `\`${key}\` pins an exact version (\`${value}\`): a pin keeps forcing it after the next ` +
          'patch ships and `pnpm update` cannot outrank it. Write a range from the fixed version; ' +
          'cap it only as luke-deps §6 describes.',
      });
    }
    if (!ADVISORY_ID.test(comment)) {
      problems.push({
        ...at,
        message:
          `\`${key}\` names no advisory: its own comment (the lines right above it, or inline) ` +
          'must carry the GHSA or CVE id it answers, or nobody can tell when to retire it.',
      });
    }
  }
}

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
  checkOverrides(root, all, problems);
  checkDependencyFamilies(all, problems);
  checkSecurityRunnerCanonicalForm(root, problems);
  checkPublishedContracts(all, problems);
  checkWebRuntimeHasNoApiSource(root, problems);
  checkPrismaBootstrap(all, problems);
  checkPrismaGeneratedTreeIsCleaned(all, problems);
  checkPrismaRelations(root, problems);
  checkEmittingWatchTasks(root, all, problems);
  checkDeclarationGraphDependencies(all, problems);
  checkWorkspaceDependencyDirection(all, problems);

  return problems;
}

function main(): void {
  const problems = checkPlatformIntegrity(REPO_ROOT);

  if (problems.length > 0) {
    throw new Error(
      `[platform-integrity] ${problems.length} problems:\n` +
        `${formatProblems(problems)}\n\n` +
        'Authority for each fact: .claude/skills/luke-deps/references/platform-policy.md'
    );
  }

  console.log(
    `[platform-integrity] ok — ${manifests(REPO_ROOT).length} manifests, ` +
      `${NODE_PIN_SITES.length} Node pins, ${DEPENDENCY_FAMILIES.length} ` +
      `dependency families, ${PUBLISHED_CONTRACTS.length} package contracts, ` +
      `${Object.keys(WORKSPACE_POLICY).length} workspace roles and ` +
      `${prismaRelations(REPO_ROOT).length} Prisma relations verified.`
  );
}

if (require.main === module) {
  main();
}
