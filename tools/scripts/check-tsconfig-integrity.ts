/**
 * Deterministic gate for the repository's TypeScript configuration
 * architecture: which runtime each `tsconfig` speaks for, what it is therefore
 * allowed to see, and which files it is allowed to reach.
 *
 * ## Why it exists
 *
 * `tsconfig.base.json` carries the runtime-neutral invariants and every other
 * project extends it, adding only what its own runtime needs. That shape is
 * prose until something enforces it, and the failure mode it prevents is
 * silent by construction: a config that omits `lib` does not get a neutral
 * one, it gets `lib.<target>.full.d.ts` — DOM, DOM.Iterable, DOM.AsyncIterable,
 * ScriptHost and WebWorker.ImportScripts. That default is how `packages/nav`
 * and `packages/calendar` had the whole browser API surface in scope, and an
 * inherited `lib` from a Next-flavoured root config is how `apps/api` did.
 * Nothing goes red when it happens; the extra types simply sit there until
 * someone writes `HTMLElement` in a Fastify handler and it compiles.
 *
 * ## The workspace source boundary
 *
 * Internal packages are consumed through their `exports` maps, never through
 * their sources. Three distinct mechanisms can undo that, and all three are
 * checked, because closing one at a time is how the boundary stayed half-open
 * through two cycles:
 *
 * - **`paths`** — an alias answered `@luke/core/<anything>`, including subpaths
 *   the `exports` map does not publish: green at typecheck,
 *   `ERR_PACKAGE_PATH_NOT_EXPORTED` at runtime.
 * - **`references`** — a reference to a composite project outranks `paths` and
 *   rebinds resolution to that project. Nothing here runs `tsc -b`, so a
 *   cross-package reference buys nothing and costs the package contract. This
 *   is a repository policy, not a claim that references are broken in general.
 * - **`files`/`include`** — root files can simply be listed. No alias, no
 *   reference, same result.
 *
 * The rules are **structural, not name-based**, and they follow symlinks. An
 * alias is a violation by where its target really lands: `"core-src/*"` is the
 * same bypass as `"@luke/core/*"`, and so is
 * `"./node_modules/@luke/core/src/*"`, which pnpm links straight back into
 * `packages/core`. An alias into the config's own package (`"@/*"`) or into a
 * genuinely external dependency (`@types/pdfmake`) is ordinary and stays green.
 *
 * ## What it checks, and against what
 *
 * The **effective, resolved** options — `extends` chains followed, defaults
 * applied, `include` globs expanded — via TypeScript's own config parser, not
 * the raw JSON. A rule written against raw JSON would have called every config
 * above compliant, because none of them mentioned DOM: they inherited it.
 *
 * ## The discovery contract
 *
 * Discovery is `git ls-files '*tsconfig*.json'`, and the guarantee is exactly:
 *
 * - every tracked config matching `tsconfig*.json` is discovered, classified
 *   against `SURFACES` in both directions, and checked;
 * - a config name outside that convention is **forbidden** wherever the
 *   repository actually reaches for it — a `tsc -p`/`--project` invocation in a
 *   tracked `package.json` script, or an `extends` edge — and reported there.
 *
 * It is not a claim to find arbitrary JSON that happens to contain
 * `compilerOptions`. An unreferenced file that no script and no chain points at
 * compiles nothing.
 *
 * ## What it does NOT establish
 *
 * **It does not certify that a program contains no DOM types.** It governs the
 * libraries a configuration *asks for*. A dependency's own
 * `/// <reference lib="dom" />` pulls DOM into a program whose config never
 * requested it, and nothing in a tsconfig can refuse it.
 *
 * That is live here, not hypothetical: `@types/pdfmake/interfaces.d.ts` opens
 * with `/// <reference lib="dom" />`, so `apps/api`, `apps/api`'s test project
 * and the root scripts project all load `lib.dom.d.ts` with this gate green,
 * and `const el: HTMLElement = ...` compiles in an ordinary Fastify source
 * file. The compensating control is per-file, and it is not uniform:
 *
 * - `apps/api` — `eslint.config.mjs` gives it Node-only globals, so `no-undef`
 *   rejects `window`, `document` and `HTMLElement`. Type exposure remains;
 *   *use* is blocked.
 * - root `scripts/**` — **no backstop at all.** That surface matches no
 *   ESLint config (`eslint scripts/…` reports "File ignored because no
 *   matching configuration was supplied") and `pnpm lint` is
 *   `turbo run lint`, which never reaches it. A DOM reference there is caught
 *   by neither tsc nor lint. Deferred gap, deliberately not closed here.
 *
 * Widening this checker to fail on injected libraries would report an
 * architecture the repository cannot change as broken, which is how a gate
 * becomes furniture. Reporting it as covered would be worse.
 *
 * It is also not a claim about package contracts. What a workspace publishes,
 * and whether a consumer therefore compiles its sources or its build, is a
 * property of a manifest rather than of any tsconfig — `apps/web` and
 * `scripts/` once consumed `@luke/api` as source purely because its
 * `main`/`types` pointed at `./src/index.ts`. No tsconfig rule could have fixed
 * that, and a gate that appeared to cover it would be worse than one that does
 * not. `checkPublishedContracts` in `check-platform-integrity.ts` owns it now,
 * where the manifests are.
 *
 * The core is a pure function over a repository root so the fixtures under
 * `__fixtures__/tsconfig/` can drive it against throwaway git repositories.
 */

import { execFileSync } from 'child_process';
import { existsSync, readFileSync, realpathSync, statSync } from 'fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'path';

import * as ts from 'typescript';

import { formatProblems, REPO_ROOT, type Problem } from './lib/report';

// ---------------------------------------------------------------------------
// Policy
//
// These are project decisions, not observations about the tree. Each config is
// assigned the runtime it actually speaks for; the rules below are derived from
// that assignment, never from what a file currently happens to contain.
// ---------------------------------------------------------------------------

/** The neutral base every other project inherits. */
const BASE = 'tsconfig.base.json';

/** The naming convention every TypeScript project config must follow. */
const CANONICAL_NAME = /^tsconfig.*\.json$/;

/**
 * What a config's runtime is allowed to see.
 *
 * - `base` — the neutral invariants themselves. Must stay runtime-free.
 * - `node` — Node only: no DOM, no JSX, NodeNext module resolution.
 * - `node-bundler` — Node code whose *loader* is a bundler. Same globals rules
 *   as `node`, but ESNext/Bundler resolution is correct rather than a defect:
 *   Vitest, not Node's module loader, is what runs `apps/api`'s test corpus.
 * - `isomorphic` — runs on both sides. DOM is permitted, and only DOM: the rest
 *   of the `lib.es2022.full` bundle is not.
 * - `web` — the browser/Next surface. DOM, JSX, bundler resolution, Next plugin.
 */
type Surface = 'base' | 'node' | 'node-bundler' | 'isomorphic' | 'web';

const SURFACES: Record<string, Surface> = {
  [BASE]: 'base',
  'tsconfig.json': 'node',
  'apps/api/tsconfig.json': 'node',
  'apps/api/tsconfig.scripts.json': 'node',
  'apps/api/tsconfig.test.json': 'node-bundler',
  'apps/web/tsconfig.json': 'web',
  'apps/web/tsconfig.test.json': 'web',
  'packages/core/tsconfig.json': 'isomorphic',
  'packages/core/tsconfig.test.json': 'isomorphic',
  'packages/db/tsconfig.json': 'node',
  'packages/nav/tsconfig.json': 'node',
  'packages/calendar/tsconfig.json': 'node',
  'packages/calendar/tsconfig.test.json': 'node',
  'tools/tsconfig.json': 'node',
};

/**
 * Library files that bring a browser (or worker) global surface with them.
 *
 * Matched by prefix on the resolved `lib.*.d.ts` names TypeScript reports, so
 * `lib.dom.asynciterable.d.ts` is covered without listing every variant.
 */
const BROWSER_LIB_PREFIXES = ['lib.dom', 'lib.webworker', 'lib.scripthost'];

/**
 * The only browser library `isomorphic` may carry.
 *
 * `packages/core` needs it for three `typeof window` guards — the ones that
 * decide which side the package is running on. It does not need DOM.Iterable,
 * DOM.AsyncIterable, ScriptHost or WebWorker.ImportScripts, which arrived only
 * because the config named no `lib` at all.
 */
const ISOMORPHIC_ALLOWED_BROWSER_LIB = 'lib.dom.d.ts';

/** `tsc -p <file>` / `tsc --project <file>` inside a package script. */
const TSC_PROJECT_FLAG = /\btsc\b[^&|;]*?\s(?:-p|--project)[\s=]+("[^"]+"|'[^']+'|\S+)/g;

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

/**
 * Tracked files matching a pathspec.
 *
 * git, not a filesystem walk: a checker must only make claims about what the
 * repo contains, or it passes locally and fails in CI (`lessons.md`,
 * "A checker that reads local state passes locally and fails in CI").
 */
function tracked(root: string, pathspec: string): string[] {
  try {
    return execFileSync('git', ['ls-files', pathspec], {
      cwd: root,
      encoding: 'utf8',
    })
      .split('\n')
      .filter(Boolean)
      .sort();
  } catch {
    return [];
  }
}

/**
 * Directories that own a package, deepest first.
 *
 * This is what makes the boundary rules structural: "another workspace" is
 * "a different one of these", not "a path that happens to start with
 * `packages/`". Derived from tracked manifests rather than from
 * `pnpm-workspace.yaml` globs, so a package that exists is seen whether or not
 * the glob list has kept up.
 */
function packageDirs(root: string): string[] {
  return tracked(root, '*package.json')
    .map(file => {
      const dir = dirname(file);
      return dir === '.' ? '' : dir;
    })
    .sort((a, b) => b.length - a.length);
}

/** The package a repo-relative path belongs to, `''` for the root package. */
function owningPackage(dirs: string[], relPath: string): string {
  for (const dir of dirs) {
    if (dir === '') return '';
    if (relPath === dir || relPath.startsWith(`${dir}/`)) return dir;
  }
  return '';
}

function isInsideRepo(relPath: string): boolean {
  return !relPath.startsWith(`..${sep}`) && !isAbsolute(relPath) && relPath !== '';
}

function hasNodeModulesSegment(relPath: string): boolean {
  return relPath.split('/').includes('node_modules');
}

// ---------------------------------------------------------------------------
// Where a path really lands
//
// pnpm links every workspace dependency into its consumer's `node_modules`, so
// `apps/api/node_modules/@luke/core` *is* `packages/core`. A lexical rule reads
// that as "inside apps/api" and waves through the exact bypass it exists to
// stop. Ownership is therefore decided after `realpath`, and only a target that
// still lands outside every tracked package is treated as external.
// ---------------------------------------------------------------------------

type Landing =
  | { kind: 'workspace'; owner: string; where: string }
  | { kind: 'external'; where: string }
  | { kind: 'outside'; where: string }
  | { kind: 'unverifiable'; where: string };

/** The longest existing ancestor of a path, or `null` if none exists. */
function existingAncestor(path: string): string | null {
  let current = path;
  for (;;) {
    if (existsSync(current)) return current;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/**
 * Classify a `paths`/`include` target.
 *
 * A wildcard never names a real file, so the probe is the prefix before the
 * first `*`; that is enough to reach the directory the alias opens up, which is
 * what ownership is about.
 */
function land(realRoot: string, dirs: string[], base: string, target: string): Landing {
  const wildcard = target.indexOf('*');
  const probe = wildcard === -1 ? target : target.slice(0, wildcard);
  const lexical = resolve(base, probe);
  const lexicalRel = relative(realRoot, lexical);

  const ancestor = existingAncestor(lexical);

  if (ancestor === null) {
    // Nothing on disk to follow at all.
    if (!isInsideRepo(lexicalRel)) return { kind: 'outside', where: lexicalRel };
    if (hasNodeModulesSegment(lexicalRel)) {
      return { kind: 'unverifiable', where: lexicalRel };
    }
    return { kind: 'workspace', owner: owningPackage(dirs, lexicalRel), where: lexicalRel };
  }

  // `realpathSync` on the deepest existing ancestor, and externality decided
  // from *that* — never from the part that does not exist. Reconstructing the
  // full path first and then looking for a `node_modules` segment classifies an
  // unresolvable `./node_modules/@luke/core/src` as external, which is exactly
  // the bypass: nothing proved it was not a workspace link.
  const realAncestor = realpathSync(ancestor);
  const realAncestorRel = relative(realRoot, realAncestor);

  if (realAncestorRel !== '' && !isInsideRepo(realAncestorRel)) {
    return { kind: 'outside', where: realAncestorRel };
  }

  // Still under `node_modules` after realpath means a genuine external
  // dependency: pnpm links a workspace package to its real directory, so a
  // workspace target has already resolved out of `node_modules` by here.
  if (hasNodeModulesSegment(realAncestorRel)) {
    return { kind: 'external', where: realAncestorRel };
  }

  const tail = relative(ancestor, lexical);

  // The resolved part is not in `node_modules`, but the unresolved tail dives
  // into one. A link that would have decided it either way is simply missing.
  if (tail !== '' && hasNodeModulesSegment(tail)) {
    return { kind: 'unverifiable', where: lexicalRel };
  }

  const real = tail === '' ? realAncestor : join(realAncestor, tail);
  const realRel = relative(realRoot, real);
  if (!isInsideRepo(realRel)) return { kind: 'outside', where: realRel };

  return { kind: 'workspace', owner: owningPackage(dirs, realRel), where: realRel };
}

// ---------------------------------------------------------------------------
// The `extends` chain
//
// Walked on the raw JSONC, because TypeScript's parser merges the chain away:
// the options it returns cannot say where they came from. That means this code
// resolves `extends` itself, so it has to accept every form TypeScript does —
// a relative path with or without `.json`, a directory, and an array — and it
// has to refuse, loudly and precisely, the one form it cannot resolve
// (a package specifier), rather than silently reporting the chain as broken.
// ---------------------------------------------------------------------------

interface ChainNode {
  /** Absolute path of the config. */
  path: string;
  /** Its parsed JSONC body. */
  json: Record<string, unknown>;
}

interface Chain {
  /** Whether any branch of the chain reaches the neutral base. */
  reachesBase: boolean;
  /** Visited configs, nearest first. `paths` provenance is read from this. */
  nodes: ChainNode[];
}

/**
 * Resolve one `extends` specifier the way `tsc` does for the forms we support.
 *
 * Returns `null` for a bare package specifier: resolving that needs
 * TypeScript's node-module lookup for config files, which this TypeScript
 * version does not expose publicly. The caller turns it into an explicit
 * diagnostic naming the specifier, never into a silent "chain does not reach
 * the base".
 */
function resolveExtendsPath(fromDir: string, specifier: string): string | null {
  if (!specifier.startsWith('.') && !isAbsolute(specifier)) return null;

  const candidate = resolve(fromDir, specifier);

  if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  if (existsSync(`${candidate}.json`)) return `${candidate}.json`;

  const inDirectory = join(candidate, 'tsconfig.json');
  if (existsSync(inDirectory)) return inDirectory;

  return candidate; // reported as missing by the caller, with this path named
}

function walkExtendsChain(root: string, file: string, problems: Problem[]): Chain {
  const nodes: ChainNode[] = [];
  /** Nodes already expanded — a diamond re-reaches one and is not a cycle. */
  const expanded = new Set<string>();
  /** The configs on the current recursion path — revisiting one *is* a cycle. */
  const onPath = new Set<string>();
  let reachesBase = false;

  /**
   * @param path - The config to expand.
   * @param declaredBy - Repo-relative config that named this edge; problems on
   *   a bad edge are attributed there, not to the leaf that started the walk.
   */
  const visit = (path: string, declaredBy: string): void => {
    const rel = relative(root, path);

    if (onPath.has(path)) {
      problems.push({
        file: declaredBy,
        line: 1,
        message: `circular \`extends\` chain, revisiting ${rel}.`,
      });
      return;
    }
    if (expanded.has(path)) {
      if (rel === BASE) reachesBase = true;
      return;
    }

    if (!existsSync(path)) {
      problems.push({
        file: declaredBy,
        line: 1,
        message: `\`extends\` chain points at ${rel}, which does not exist.`,
      });
      return;
    }

    if (!CANONICAL_NAME.test(basename(path))) {
      problems.push({
        file: declaredBy,
        line: 1,
        message:
          `\`extends\` reaches ${rel}, which does not follow the ` +
          '`tsconfig*.json` naming convention every TypeScript project config ' +
          'in this repository must follow to be discovered and classified.',
      });
    }

    if (rel === BASE) reachesBase = true;

    const parsed = ts.parseConfigFileTextToJson(path, readFileSync(path, 'utf8'));

    // A malformed parent must be reported as what it is. Dropping this
    // diagnostic leaves `config` without an `extends` key, and the child gets
    // blamed for a chain that "does not reach the base" — the wrong file and
    // the wrong defect, with the real syntax error discarded.
    if (parsed.error) {
      problems.push({
        file: rel,
        line: 1,
        message: `cannot be parsed: ${ts.flattenDiagnosticMessageText(parsed.error.messageText, ' ')}`,
      });
      expanded.add(path);
      return;
    }

    // `parseConfigFileTextToJson` returns `config` as `any` by design — it is
    // arbitrary JSON. Narrowing to the two members read here is the only way to
    // walk the chain and locate the config that declares `paths`.
    const json = (parsed.config ?? {}) as Record<string, unknown>;
    nodes.push({ path, json });

    onPath.add(path);
    expanded.add(path);

    const specifiers = Array.isArray(json.extends)
      ? json.extends
      : json.extends === undefined
        ? []
        : [json.extends];

    for (const specifier of specifiers) {
      if (typeof specifier !== 'string') {
        problems.push({
          file: rel,
          line: 1,
          message: '`extends` must be a string or an array of strings.',
        });
        continue;
      }

      const next = resolveExtendsPath(dirname(path), specifier);
      if (next === null) {
        problems.push({
          file: rel,
          line: 1,
          message:
            `\`extends\` resolves through a package specifier (\`${specifier}\`), ` +
            'whose provenance this gate cannot verify. Extend a path inside the ' +
            'repository, so the chain to the neutral base is checkable.',
        });
        continue;
      }
      visit(next, rel);
    }

    onPath.delete(path);
  };

  visit(resolve(root, file), file);

  return { reachesBase, nodes };
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

interface Resolved {
  file: string;
  surface: Surface;
  options: ts.CompilerOptions;
  references: readonly ts.ProjectReference[];
  /** Root files the config selects through `files`/`include`. */
  fileNames: readonly string[];
  /** Directory the effective `paths` are resolved against. */
  pathsBase: string;
}

/**
 * Effective compiler options, with `extends` followed and defaults applied.
 *
 * A parse error is a problem rather than a skip: a config TypeScript cannot
 * read is exactly the state this gate must not wave through.
 */
function parseConfig(
  root: string,
  file: string,
  problems: Problem[]
): ts.ParsedCommandLine | null {
  const path = join(root, file);
  const host: ts.ParseConfigFileHost = {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: () => undefined,
  };

  const parsed = ts.getParsedCommandLineOfConfigFile(path, {}, host);

  if (!parsed) {
    problems.push({
      file,
      line: 1,
      message: 'TypeScript could not read this config (missing or unparsable).',
    });
    return null;
  }

  // Only configuration diagnostics matter here. File-level errors (an empty
  // `include`, say) are a different gate's business — `pnpm typecheck` — and
  // reporting them here would make this checker fail for reasons it cannot
  // explain.
  for (const d of parsed.errors) {
    if (d.category !== ts.DiagnosticCategory.Error) continue;
    if (d.code === 18003) continue; // "No inputs were found" — not our concern.
    problems.push({
      file,
      line: 1,
      message: `config error TS${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`,
    });
  }

  return parsed;
}

/**
 * The directory the effective `paths` are resolved against.
 *
 * `baseUrl` when one is set; otherwise the directory of the *nearest* config in
 * the chain that declares `paths`, which is how TypeScript resolves them. A
 * child's `paths` replaces its parent's wholesale rather than merging, so
 * "nearest declaring config" is the whole rule.
 */
function pathsBaseDir(
  options: ts.CompilerOptions,
  chain: Chain,
  fallback: string
): string {
  if (typeof options.baseUrl === 'string') return options.baseUrl;

  for (const node of chain.nodes) {
    const compilerOptions = node.json.compilerOptions;
    if (
      typeof compilerOptions === 'object' &&
      compilerOptions !== null &&
      'paths' in compilerOptions
    ) {
      return dirname(node.path);
    }
  }
  return fallback;
}

// ---------------------------------------------------------------------------
// Invariants
// ---------------------------------------------------------------------------

function browserLibs(options: ts.CompilerOptions): string[] {
  return (options.lib ?? []).filter(l =>
    BROWSER_LIB_PREFIXES.some(prefix => l.startsWith(prefix))
  );
}

function hasNextPlugin(options: ts.CompilerOptions): boolean {
  // `plugins` reaches `CompilerOptions` through its index signature, so it is
  // typed as the union of every possible option value rather than as
  // `PluginImport[]`. Narrowing it is the only way to read the plugin names.
  const plugins = options.plugins as ts.PluginImport[] | undefined;
  return (plugins ?? []).some(p => p.name === 'next');
}

/**
 * `lib` must be stated, everywhere.
 *
 * An unset `lib` is not neutrality — it is `lib.<target>.full.d.ts`, DOM
 * included. TypeScript reports that default as `undefined` rather than as an
 * expanded list, so silence here is precisely the defect and not evidence of
 * its absence.
 */
function checkLibIsExplicit(c: Resolved, problems: Problem[]): boolean {
  if (c.options.lib !== undefined) return true;
  problems.push({
    file: c.file,
    line: 1,
    message:
      'no configured `lib`: TypeScript then loads `lib.<target>.full.d.ts`, ' +
      'which includes DOM. State the libraries this runtime actually has.',
  });
  return false;
}

function checkGlobals(c: Resolved, problems: Problem[]): void {
  if (!checkLibIsExplicit(c, problems)) return;

  const browser = browserLibs(c.options);

  if (c.surface === 'node' || c.surface === 'node-bundler') {
    if (browser.length > 0) {
      problems.push({
        file: c.file,
        line: 1,
        message: `Node-only surface configuring browser libraries: ${browser.join(', ')}.`,
      });
    }
  }

  if (c.surface === 'isomorphic') {
    const extra = browser.filter(l => l !== ISOMORPHIC_ALLOWED_BROWSER_LIB);
    if (!browser.includes(ISOMORPHIC_ALLOWED_BROWSER_LIB)) {
      problems.push({
        file: c.file,
        line: 1,
        message:
          `isomorphic surface without ${ISOMORPHIC_ALLOWED_BROWSER_LIB}: its ` +
          '`typeof window` guards cannot typecheck.',
      });
    }
    if (extra.length > 0) {
      problems.push({
        file: c.file,
        line: 1,
        message:
          `isomorphic surface configures more than the justified DOM exception: ${extra.join(', ')}.`,
      });
    }
  }

  if (c.surface === 'web' && browser.length === 0) {
    problems.push({
      file: c.file,
      line: 1,
      message: 'web surface configuring no DOM library.',
    });
  }

  if (c.surface === 'base' && browser.length > 0) {
    problems.push({
      file: c.file,
      line: 1,
      message: `the neutral base is not runtime-free: ${browser.join(', ')}.`,
    });
  }
}

function checkJsxAndPlugins(c: Resolved, problems: Problem[]): void {
  const isWeb = c.surface === 'web';

  if (!isWeb && c.options.jsx !== undefined) {
    problems.push({
      file: c.file,
      line: 1,
      message: 'non-web surface configuring `jsx`.',
    });
  }
  if (!isWeb && hasNextPlugin(c.options)) {
    problems.push({
      file: c.file,
      line: 1,
      message: 'non-web surface carrying the Next TypeScript plugin.',
    });
  }
  if (isWeb && c.options.jsx === undefined) {
    problems.push({ file: c.file, line: 1, message: 'web surface without `jsx`.' });
  }
  if (isWeb && !hasNextPlugin(c.options)) {
    problems.push({
      file: c.file,
      line: 1,
      message: 'web surface without the Next TypeScript plugin.',
    });
  }
}

function checkModuleResolution(c: Resolved, problems: Problem[]): void {
  const { module: mod, moduleResolution: res } = c.options;

  if (c.surface === 'base') {
    if (mod !== undefined || res !== undefined) {
      problems.push({
        file: c.file,
        line: 1,
        message:
          'the neutral base sets `module`/`moduleResolution`: there is no ' +
          'repository-wide value, each runtime owns its own.',
      });
    }
    return;
  }

  const wantsBundler = c.surface === 'web' || c.surface === 'node-bundler';

  if (wantsBundler) {
    if (res !== ts.ModuleResolutionKind.Bundler) {
      problems.push({
        file: c.file,
        line: 1,
        message: 'bundler-loaded surface not using `moduleResolution: bundler`.',
      });
    }
    return;
  }

  if (mod !== ts.ModuleKind.NodeNext || res !== ts.ModuleResolutionKind.NodeNext) {
    problems.push({
      file: c.file,
      line: 1,
      message:
        'Node surface not on NodeNext: bundler semantics would stop requiring ' +
        'the explicit `.js` specifiers Node ESM needs.',
    });
  }
}

/**
 * No config may alias into another package's files.
 *
 * Structural and symlink-aware: the violation is where the target really lands.
 * Checked on the resolved options, so an alias declared in a parent is caught
 * in every child that inherits it.
 */
function checkNoCrossPackageAlias(
  realRoot: string,
  dirs: string[],
  c: Resolved,
  problems: Problem[]
): void {
  const owner = owningPackage(dirs, c.file);

  for (const [key, targets] of Object.entries(c.options.paths ?? {})) {
    for (const target of targets) {
      const landing = land(realRoot, dirs, c.pathsBase, target);

      if (landing.kind === 'external' || landing.kind === 'outside') continue;

      if (landing.kind === 'unverifiable') {
        problems.push({
          file: c.file,
          line: 1,
          message:
            `\`paths\` alias \`${key}\` points into \`node_modules\` at a path ` +
            `that does not exist (${landing.where}), so this gate cannot tell a ` +
            'workspace link from an external dependency. Install the workspace ' +
            'or point the alias at a real target.',
        });
        continue;
      }

      if (landing.owner === owner) continue;

      problems.push({
        file: c.file,
        line: 1,
        message:
          `\`paths\` alias \`${key}\` reaches into ${landing.owner || 'the root package'} ` +
          `(${landing.where}), bypassing that package's \`exports\` map. A wildcard form ` +
          'additionally type-resolves subpaths the package does not publish, ' +
          'which fail at runtime with ERR_PACKAGE_PATH_NOT_EXPORTED.',
      });
    }
  }
}

/**
 * A project reference into another package is the same bypass by another door.
 *
 * `references` outranks `paths`: a reference to a composite project rebinds
 * resolution to that project regardless of any alias, which is why removing
 * only one of the two mechanisms left the boundary half-open. This is a
 * repository policy — nothing here runs `tsc -b`, so a cross-package reference
 * costs the package contract and buys nothing — not a claim that project
 * references are wrong in general.
 *
 * Unlike `paths`, `references` is not inherited through `extends`, so this
 * reads each config's own resolved list.
 */
function checkNoCrossPackageReference(
  realRoot: string,
  dirs: string[],
  c: Resolved,
  problems: Problem[]
): void {
  const owner = owningPackage(dirs, c.file);

  for (const reference of c.references) {
    const landing = land(realRoot, dirs, '/', reference.path);
    if (landing.kind !== 'workspace' || landing.owner === owner) continue;

    problems.push({
      file: c.file,
      line: 1,
      message:
        `project reference into ${landing.owner || 'the root package'} (${landing.where}). ` +
        'A reference outranks `paths` and rebinds resolution to that project, ' +
        "re-establishing the source boundary the package's `exports` map is " +
        'meant to own.',
    });
  }
}

/**
 * A config may not directly own another package's root files.
 *
 * `files`/`include` needs no alias and no reference: listing the sources works
 * just as well. This reads the **root** files TypeScript selected, so a file
 * that merely arrives by *import* — whatever a package's manifest resolves to —
 * is untouched by it. That traversal is a package-contract problem, owned by
 * `checkPublishedContracts` in `check-platform-integrity.ts`, and deliberately
 * not this rule's business.
 *
 * The neutral base is exempt, and only the base: it declares no `include`, so
 * TypeScript's default expands it across the whole repository. That selection
 * is meaningless — it is an inheritance fragment, and every config that extends
 * it declares an `include` of its own, which replaces the inherited one. What
 * stops it from ever being compiled as a project is `checkProjectInvocations`,
 * which enumerates what the repository actually invokes.
 */
function checkNoCrossPackageRootFiles(
  realRoot: string,
  dirs: string[],
  c: Resolved,
  problems: Problem[]
): void {
  if (c.surface === 'base') return;

  const owner = owningPackage(dirs, c.file);
  const offenders = new Set<string>();

  for (const fileName of c.fileNames) {
    const landing = land(realRoot, dirs, '/', fileName);
    if (landing.kind !== 'workspace' || landing.owner === owner) continue;
    offenders.add(landing.owner || 'the root package');
  }

  for (const offender of offenders) {
    problems.push({
      file: c.file,
      line: 1,
      message:
        `\`files\`/\`include\` selects root files owned by ${offender}. A config ` +
        "compiles its own package's sources; another package's are reached " +
        'through its `exports` map, not by listing them.',
    });
  }
}

/**
 * Every TypeScript project the repository actually invokes must be discoverable.
 *
 * Discovery is `tsconfig*.json`, and this is what stops that convention from
 * being sidestepped: a `tsc -p ts.build.json` in a tracked script would compile
 * a project no classification rule ever sees. Scope is deliberate and stated —
 * tracked `package.json` scripts, which is where this repository invokes tsc —
 * rather than an open-ended search for every possible caller.
 */
function checkProjectInvocations(
  root: string,
  discovered: string[],
  problems: Problem[]
): void {
  for (const manifest of tracked(root, '*package.json')) {
    const text = readFileSync(join(root, manifest), 'utf8');
    let json: { scripts?: Record<string, string> };
    try {
      json = JSON.parse(text) as { scripts?: Record<string, string> };
    } catch {
      continue; // a malformed manifest is the platform gate's business
    }

    const packageDir = dirname(manifest) === '.' ? '' : dirname(manifest);

    for (const [name, script] of Object.entries(json.scripts ?? {})) {
      for (const match of script.matchAll(TSC_PROJECT_FLAG)) {
        const target = match[1].replace(/^["']|["']$/g, '');
        const relTarget = relative(root, resolve(join(root, packageDir), target));

        if (!CANONICAL_NAME.test(basename(relTarget))) {
          problems.push({
            file: manifest,
            line: 1,
            message:
              `script \`${name}\` compiles \`${relTarget}\`, whose name is outside the ` +
              '`tsconfig*.json` convention. A project config named otherwise is ' +
              'never discovered, never classified, and silently exempt from ' +
              'every rule in this gate.',
          });
          continue;
        }

        if (!discovered.includes(relTarget)) {
          problems.push({
            file: manifest,
            line: 1,
            message:
              `script \`${name}\` compiles \`${relTarget}\`, which is not tracked ` +
              'by git and therefore never discovered or classified.',
          });
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------

export function checkTsconfigIntegrity(root: string): Problem[] {
  const problems: Problem[] = [];
  const found = tracked(root, '*tsconfig*.json');

  if (found.length === 0) {
    throw new Error(
      '[tsconfig-integrity] no tracked tsconfig found. Either this is not a ' +
        'git repository or the configs are untracked: every check below would ' +
        'pass without having read anything.'
    );
  }

  const dirs = packageDirs(root);
  // The fixtures run under the OS temp directory, which is itself a symlink on
  // macOS. Comparing realpath'd targets against a non-realpath'd root would
  // read every one of them as outside the repository.
  const realRoot = realpathSync(root);

  // Both directions of the classification table. An unclassified config must
  // fail rather than escape the policy, and a stale entry must fail rather than
  // let a deleted surface look covered.
  for (const file of found) {
    if (SURFACES[file] === undefined) {
      problems.push({
        file,
        line: 1,
        message:
          'unclassified TypeScript config: add it to `SURFACES` in ' +
          'tools/scripts/check-tsconfig-integrity.ts with the runtime it ' +
          'speaks for.',
      });
    }
  }
  for (const file of Object.keys(SURFACES)) {
    if (!found.includes(file)) {
      problems.push({
        file,
        line: 1,
        message: 'classified in `SURFACES` but not tracked in the repository.',
      });
    }
  }

  checkProjectInvocations(root, found, problems);

  for (const file of found) {
    const surface = SURFACES[file];
    if (surface === undefined) continue;

    const chain = walkExtendsChain(root, file, problems);
    if (surface !== 'base' && !chain.reachesBase) {
      problems.push({
        file,
        line: 1,
        message: `\`extends\` chain does not reach ${BASE}.`,
      });
    }

    const parsed = parseConfig(root, file, problems);
    if (parsed === null) continue;

    const resolved: Resolved = {
      file,
      surface,
      options: parsed.options,
      references: parsed.projectReferences ?? [],
      fileNames: parsed.fileNames,
      pathsBase: pathsBaseDir(parsed.options, chain, dirname(join(root, file))),
    };

    checkGlobals(resolved, problems);
    checkJsxAndPlugins(resolved, problems);
    checkModuleResolution(resolved, problems);
    checkNoCrossPackageAlias(realRoot, dirs, resolved, problems);
    checkNoCrossPackageReference(realRoot, dirs, resolved, problems);
    checkNoCrossPackageRootFiles(realRoot, dirs, resolved, problems);
  }

  return problems;
}

function main(): void {
  const problems = checkTsconfigIntegrity(REPO_ROOT);

  if (problems.length > 0) {
    throw new Error(
      `[tsconfig-integrity] ${problems.length} problems:\n` +
        `${formatProblems(problems)}\n\n` +
        'Architecture: tsconfig.base.json carries the runtime-neutral ' +
        'invariants; each project adds only what its own runtime needs.'
    );
  }

  console.log(
    `[tsconfig-integrity] ok — ${Object.keys(SURFACES).length} tsconfig*.json ` +
      'projects match the runtime policy they are classified under, and no ' +
      'script compiles a project outside that naming convention.\n' +
      '  Scope: the libraries each config *asks for*, not the types its program ' +
      'ends up loading.\n' +
      '  Known exception: @types/pdfmake carries `/// <reference lib="dom" />`, ' +
      'so apps/api, its test project and\n' +
      '  the root scripts project load lib.dom.d.ts regardless. ESLint ' +
      'no-undef covers apps/api; root scripts/** has no backstop.'
  );
}

if (require.main === module) {
  main();
}
