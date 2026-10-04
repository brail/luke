/**
 * Refuses a pnpm override that holds a package below what one of its consumers declares.
 *
 * The incident: `fast-uri: '>=3.1.6 <4'` was written while nothing used fast-uri 4, as a cap above
 * the advisory's floor. A month later `fast-json-stringify@7` arrived declaring `fast-uri ^4`, and the
 * override silently ran it on 3.x. Nothing reported it: pnpm rewrites a consumer's declared range
 * before resolving, so the lockfile only ever shows the rewritten one, and `pnpm peers check` sees
 * peers alone.
 *
 * Only the downward case is refused. An override that lifts a consumer above its own range is how a
 * fix reaches a package pinned to a vulnerable version; that is a decision its GHSA/CVE comment
 * justifies (P15 in `check-platform-integrity`), not an accident.
 *
 * A post-install check, and on purpose the exception to "a checker reads tracked state only"
 * (lessons.md): the declared ranges exist only in each installed package's own `package.json`. It
 * refuses an install that is missing or does not match `pnpm-lock.yaml`, and reads only packages that
 * lockfile resolves, so a leftover store directory changes nothing.
 *
 * Limits: a consumer's bundled tree and platform-specific packages not installed on this machine are
 * not inspected. Green means no installed consumer is held below its range, not that no possible one
 * could be.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Range, gtr, intersects, minVersion, validRange, type SemVer } from 'semver';

import { lockfilePackages } from './lib/pnpmLockfile';
import { mapping } from './lib/pnpmWorkspace';
import { REPO_ROOT, formatProblems, type Problem } from './lib/report';

interface Manifest {
  name?: string;
  version?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
  bundleDependencies?: string[] | boolean;
  bundledDependencies?: string[] | boolean;
}

interface Consumer {
  /** `name@version` for an installed package, the manifest path for a workspace one. */
  label: string;
  manifest: Manifest;
  /** Workspace manifests: pnpm applies overrides to their devDependencies too. */
  workspace: boolean;
}

/** One declared edge towards the overridden package. */
interface Edge {
  consumer: string;
  declared: string;
  optionalPeer: boolean;
}

/** Specifiers that name no registry version range: the override question does not arise. */
const NOT_A_RANGE = /^(?:workspace|link|file|portal|catalog|git|git\+[a-z]+|github|https?):/;

/** A range's comparator sets, each as a range of its own (`*` is the empty string). */
const sets = (range: string): string[] =>
  new Range(range).set.map(set => set.map(comparator => comparator.value).join(' '));

/**
 * Whether a comparator set admits any version. Not `minVersion(set) !== null`: `minVersion` also
 * answers null for a set only a prerelease satisfies (`>4.0.0 <4.0.1-beta` admits `4.0.1-alpha`).
 */
const admitsAVersion = (set: string): boolean => intersects(set, '*');

/**
 * The least version a range admits, over the sets that admit one; `'unknown'` when a set admits a
 * version `minVersion` cannot name, null when no set admits any.
 */
function floor(range: string): SemVer | 'unknown' | null {
  let least: SemVer | null = null;
  for (const set of sets(range).filter(admitsAVersion)) {
    const min = minVersion(set);
    if (min === null) return 'unknown';
    if (least === null || min.compare(least) < 0) least = min;
  }
  return least;
}

/** A package's declared range for `name`, unwrapping an `npm:` alias, or null when it names none. */
function declaredRange(spec: string): string | null {
  if (NOT_A_RANGE.test(spec)) return null;
  const alias = spec.match(/^npm:(?:@[^/@]+\/)?[^@]+@(.*)$/);
  return alias ? alias[1] : spec;
}

/** Whether the consumer ships `name` inside its own tarball: a bundle covers dependencies, never peers. */
function bundles(manifest: Manifest, name: string): boolean {
  const list = manifest.bundleDependencies ?? manifest.bundledDependencies;
  return list === true || (Array.isArray(list) && list.includes(name));
}

/** Every edge from a consumer to `name`, in the fields pnpm rewrites for that consumer. */
function edgesTo(name: string, consumers: Consumer[]): Edge[] {
  const edges: Edge[] = [];
  for (const { label, manifest, workspace } of consumers) {
    const bundled = bundles(manifest, name);
    const fields = [
      bundled ? undefined : manifest.dependencies,
      bundled ? undefined : manifest.optionalDependencies,
      workspace ? manifest.devDependencies : undefined,
    ];
    for (const field of fields) {
      const spec = field?.[name];
      if (spec !== undefined) edges.push({ consumer: label, declared: spec, optionalPeer: false });
    }
    const peer = manifest.peerDependencies?.[name];
    if (peer !== undefined) {
      const optionalPeer = manifest.peerDependenciesMeta?.[name]?.optional === true;
      edges.push({ consumer: label, declared: peer, optionalPeer });
    }
  }
  return edges;
}

function readJson(path: string): Manifest {
  return JSON.parse(readFileSync(path, 'utf8')) as Manifest;
}

/** The packages the virtual store holds and the current lockfile resolves, every version of each. */
function installedConsumers(root: string, locked: Map<string, Set<string>>): Consumer[] {
  const store = join(root, 'node_modules', '.pnpm');
  const consumers: Consumer[] = [];
  for (const entry of readdirSync(store)) {
    const modules = join(store, entry, 'node_modules');
    if (entry === 'node_modules' || !existsSync(modules)) continue;
    const dirs = readdirSync(modules).flatMap(child =>
      child.startsWith('@')
        ? readdirSync(join(modules, child)).map(name => join(modules, child, name))
        : [join(modules, child)]
    );
    for (const dir of dirs) {
      // The package itself is the one real directory; its dependencies are symlinks.
      if (lstatSync(dir).isSymbolicLink() || !existsSync(join(dir, 'package.json'))) continue;
      const manifest = readJson(join(dir, 'package.json'));
      const { name, version } = manifest;
      if (name === undefined || version === undefined || !locked.get(name)?.has(version)) continue;
      consumers.push({ label: `${name}@${version}`, manifest, workspace: false });
    }
  }
  return consumers;
}

function workspaceConsumers(root: string): Consumer[] {
  const files = execFileSync('git', ['ls-files', '-z', '--', '*package.json', 'package.json'], {
    cwd: root,
    encoding: 'utf8',
  })
    .split('\0')
    .filter(Boolean);
  return [...new Set(files)].map(file => {
    const manifest = readJson(join(root, file));
    return { label: `${manifest.name ?? 'workspace'} (${file})`, manifest, workspace: true };
  });
}

/** `name@selector` → name and selector; a scoped name keeps its leading `@`. */
function splitKey(key: string): { name: string; selector: string | null } {
  const at = key.indexOf('@', 1);
  return at === -1 ? { name: key, selector: null } : { name: key.slice(0, at), selector: key.slice(at + 1) };
}

/** Every override that holds an installed or workspace consumer below its declared range. */
export function checkOverrideConsumers(root: string): Problem[] {
  const file = 'pnpm-workspace.yaml';
  const yaml = existsSync(join(root, file)) ? readFileSync(join(root, file), 'utf8') : null;
  const entries = yaml === null ? null : mapping(yaml, 'overrides');
  if (entries === null || entries.length === 0) return [];

  const lockPath = join(root, 'pnpm-lock.yaml');
  const storeLock = join(root, 'node_modules', '.pnpm', 'lock.yaml');
  const lock = existsSync(lockPath) ? readFileSync(lockPath, 'utf8') : null;
  if (lock === null || !existsSync(storeLock) || readFileSync(storeLock, 'utf8') !== lock) {
    return [
      {
        file: 'node_modules/.pnpm/lock.yaml',
        line: 1,
        message:
          'the install is missing or stale (the store does not match pnpm-lock.yaml): run ' +
          '`pnpm install`, then this check — it reads the declared ranges of the installed packages.',
      },
    ];
  }

  const consumers = [...installedConsumers(root, lockfilePackages(lock)), ...workspaceConsumers(root)];
  const problems: Problem[] = [];

  for (const { key, value, line } of entries) {
    const { name, selector } = splitKey(key);
    // A dead branch is refused rather than dropped: `gtr` reads one as below everything.
    if (validRange(value) === null || !sets(value).every(admitsAVersion)) {
      problems.push({ file, line, message: `\`${key}\`: its target \`${value}\` has a branch that admits no version.` });
      continue;
    }

    for (const { consumer, declared, optionalPeer } of edgesTo(name, consumers)) {
      // pnpm matches a selector against the declared specifier as written, so an alias or a tag
      // never meets one: that override does not reach the edge at all.
      if (selector !== null && (validRange(declared) === null || !intersects(declared, selector))) continue;
      const range = declaredRange(declared);
      if (range === null) continue;
      const least = validRange(range) === null ? null : floor(range);
      if (least === null || least === 'unknown') {
        problems.push({
          file,
          line,
          message:
            `\`${key}\`: cannot evaluate what ${consumer} declares (\`${declared}\`), so it cannot ` +
            'tell whether the override holds it below its range. Check it by hand with `pnpm why -r`.',
        });
        continue;
      }
      if (gtr(least, value)) {
        problems.push({
          file,
          line,
          message:
            `\`${key}\` (\`${value}\`) is entirely below what ${consumer} declares ` +
            `(\`${declared}\`${optionalPeer ? ', an optional peer' : ''}): the override forces it off its ` +
            'own range. Raise or drop the cap, after `pnpm why -r` (luke-deps §6).',
        });
      }
    }
  }
  return problems;
}

function main(): void {
  const problems = checkOverrideConsumers(REPO_ROOT);
  if (problems.length > 0) {
    throw new Error(`[override-consumers] ${problems.length} problem(s):\n${formatProblems(problems)}`);
  }
  console.log('[override-consumers] ok — no installed or workspace consumer is held below its declared range.');
}

if (require.main === module) main();
