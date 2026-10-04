/**
 * Refuses a pnpm override that holds a package below what one of its consumers declares.
 *
 * The incident: `fast-uri: '>=3.1.6 <4'` was written while nothing used fast-uri 4, as a cap above
 * the advisory's floor. A month later `fast-json-stringify@7` arrived declaring `fast-uri ^4`, and the
 * override silently ran it on 3.x. Nothing reported it: pnpm rewrites a consumer's declared range
 * before resolving, so the lockfile only ever shows the rewritten one, and `pnpm peers check` sees
 * peers alone.
 *
 * Two questions, both downward only:
 * - does the override admit nothing the consumer accepts (its target is entirely below the least
 *   version the consumer declares)?
 * - is the version actually installed for the consumer below that least version? A cap can admit the
 *   consumer's range in theory and still install below it, when the versions it would need are not
 *   published, or still in the release-age quarantine.
 * An override that lifts a consumer above its own range is how a fix reaches a package pinned to a
 * vulnerable version; that is a decision its GHSA/CVE comment justifies (P15 in
 * `check-platform-integrity`), not an accident.
 *
 * A post-install check, and on purpose the exception to "a checker reads tracked state only"
 * (lessons.md): the declared ranges exist only in each installed package's own `package.json`. It
 * refuses an install that is missing or does not match `pnpm-lock.yaml`, and reads only packages that
 * lockfile resolves, so a leftover store directory changes nothing.
 *
 * Limits: a consumer's bundled tree and platform-specific packages not installed on this machine are
 * not inspected, and a peer is judged by its declared range only (the lockfile records a resolved peer
 * in the snapshot key, not as an edge). Green means no installed consumer is held below its range,
 * not that no possible one could be.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { Range, gtr, intersects, lt, minVersion, valid, validRange, type SemVer } from 'semver';

import { lockfilePackages, lockfileResolutions } from './lib/pnpmLockfile';
import { mapping, splitSelector } from './lib/pnpmWorkspace';
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
  /** How a problem names it: `name@version`, or `name (path/package.json)` for a workspace one. */
  label: string;
  /** Its key in `lockfileResolutions`: `name@version`, or `importer:<path>`. */
  resolutionKey: string;
  manifest: Manifest;
  /** Workspace manifests: pnpm applies overrides to their devDependencies too. */
  workspace: boolean;
}

/** One declared edge towards the overridden package. */
interface Edge {
  consumer: Consumer;
  declared: string;
  peer: boolean;
  optionalPeer: boolean;
}

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

/**
 * A declared specifier's version range, unwrapping an `npm:` alias; null for one that names no
 * registry version at all (a protocol, a URL, a path, a `user/repo` shorthand). A bare word that is
 * not a range (`latest`) comes back as it is, for the caller to report.
 */
function declaredRange(spec: string): string | null {
  const alias = spec.match(/^npm:(?:@[^/@]+\/)?[^@]+@(.*)$/);
  if (alias) return alias[1] ?? null;
  return validRange(spec) === null && /[:/]/.test(spec) ? null : spec;
}

/** Whether the consumer ships `name` inside its own tarball: a bundle covers dependencies, never peers. */
function bundles(manifest: Manifest, name: string): boolean {
  const list = manifest.bundleDependencies ?? manifest.bundledDependencies;
  return list === true || (Array.isArray(list) && list.includes(name));
}

/** Every edge from a consumer to `name`, in the fields pnpm rewrites for that consumer. */
function edgesTo(name: string, consumers: Consumer[]): Edge[] {
  const edges: Edge[] = [];
  for (const consumer of consumers) {
    const { manifest, workspace } = consumer;
    const bundled = bundles(manifest, name);
    const fields = [
      bundled ? undefined : manifest.dependencies,
      bundled ? undefined : manifest.optionalDependencies,
      workspace ? manifest.devDependencies : undefined,
    ];
    for (const field of fields) {
      const spec = field?.[name];
      if (spec !== undefined) edges.push({ consumer, declared: spec, peer: false, optionalPeer: false });
    }
    const peer = manifest.peerDependencies?.[name];
    if (peer !== undefined) {
      const optionalPeer = manifest.peerDependenciesMeta?.[name]?.optional === true;
      edges.push({ consumer, declared: peer, peer: true, optionalPeer });
    }
  }
  return edges;
}

function readJson(path: string): Manifest {
  // `JSON.parse` answers `any`; `Manifest` names only the fields read here, every one optional.
  return JSON.parse(readFileSync(path, 'utf8')) as Manifest;
}

/** The packages the virtual store holds and the current lockfile resolves, every version of each. */
function installedConsumers(root: string, locked: Map<string, Set<string>>): Consumer[] {
  const store = join(root, 'node_modules', '.pnpm');
  const consumers = new Map<string, Consumer>();
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
      // Peer variants of one version share a manifest: one consumer, not one per variant.
      const label = `${name}@${version}`;
      consumers.set(label, { label, resolutionKey: label, manifest, workspace: false });
    }
  }
  return [...consumers.values()];
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
    return {
      label: `${manifest.name ?? 'workspace'} (${file})`,
      resolutionKey: `importer:${dirname(file)}`,
      manifest,
      workspace: true,
    };
  });
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
  const resolutions = lockfileResolutions(lock);
  const problems = new Map<string, Problem>();
  const report = (line: number, message: string): void => {
    problems.set(`${line}\0${message}`, { file, line, message });
  };

  for (const { key, value, line } of entries) {
    const { pattern: name, version: selector } = splitSelector(key);
    if (validRange(value) === null) {
      report(line, `\`${key}\`: its target \`${value}\` is not a version range the override checks model (P15 refuses it).`);
      continue;
    }
    // A dead branch is refused rather than dropped: `gtr` reads one as below everything.
    if (!sets(value).every(admitsAVersion)) {
      report(line, `\`${key}\`: its target \`${value}\` has a branch that admits no version.`);
      continue;
    }

    for (const { consumer, declared, peer, optionalPeer } of edgesTo(name, consumers)) {
      // pnpm matches a selector against the declared specifier as written, so an alias or a tag
      // never meets one: that override does not reach the edge at all.
      if (selector !== undefined && (validRange(declared) === null || !intersects(declared, selector))) continue;
      const range = declaredRange(declared);
      if (range === null) continue;
      const least = validRange(range) === null ? null : floor(range);
      if (least === null || least === 'unknown') {
        report(
          line,
          `\`${key}\`: cannot evaluate what ${consumer.label} declares (\`${declared}\`), so it cannot ` +
            'tell whether the override holds it below its range. Check it by hand with `pnpm why -r`.'
        );
        continue;
      }
      const role = optionalPeer ? ', an optional peer' : '';
      if (gtr(least, value)) {
        report(
          line,
          `\`${key}\` (\`${value}\`) is entirely below what ${consumer.label} declares ` +
            `(\`${declared}\`${role}): the override forces it off its own range. Raise or drop the cap, ` +
            'after `pnpm why -r` (luke-deps §6).'
        );
        continue;
      }
      if (peer) continue;
      for (const installed of resolutions.get(consumer.resolutionKey)?.get(name) ?? []) {
        if (valid(installed) !== null && lt(installed, least)) {
          report(
            line,
            `\`${key}\` (\`${value}\`) installs ${name} ${installed} for ${consumer.label}, below what it ` +
              `declares (\`${declared}\`): the versions the cap would allow above that are not ` +
              'installable. Raise or drop the cap (luke-deps §6).'
          );
        }
      }
    }
  }
  return [...problems.values()];
}

function main(): void {
  const problems = checkOverrideConsumers(REPO_ROOT);
  if (problems.length > 0) {
    throw new Error(`[override-consumers] ${problems.length} problem(s):\n${formatProblems(problems)}`);
  }
  console.log('[override-consumers] ok — no installed or workspace consumer is held below its declared range.');
}

if (require.main === module) main();
