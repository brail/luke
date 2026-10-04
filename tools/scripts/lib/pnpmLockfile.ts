/**
 * The resolved packages of a v9 `pnpm-lock.yaml`, read from the keys of its
 * `packages:` block. Hand-parsed for the same reason as `pnpmWorkspace.ts`: no
 * workspace declares a YAML library.
 *
 * Shared by `check-platform-integrity` and `check-override-consumers`.
 */

/** A resolved version as the lockfile writes it, without its peer suffix or alias name. */
function plainVersion(written: string): string | null {
  if (/^(?:link|file|workspace):/.test(written)) return null;
  const head = written.split('(')[0] ?? '';
  return head.slice(head.lastIndexOf('@') + 1) || null;
}

const unquote = (text: string): string => text.replace(/^'(.*)'$/, '$1');

/**
 * What each consumer resolved each of its dependencies to: installed packages keyed
 * `name@version` (from `snapshots:`, peer variants merged), workspace packages keyed
 * `importer:<path>` (from `importers:`). Peers are not listed: the lockfile records them in
 * the snapshot key, not as an edge.
 */
export function lockfileResolutions(text: string): Map<string, Map<string, Set<string>>> {
  const resolved = new Map<string, Map<string, Set<string>>>();
  const record = (consumer: string, dependency: string, written: string): void => {
    const version = plainVersion(written);
    if (version === null) return;
    const byDependency = resolved.get(consumer) ?? new Map<string, Set<string>>();
    byDependency.set(dependency, (byDependency.get(dependency) ?? new Set()).add(version));
    resolved.set(consumer, byDependency);
  };

  let block: 'importers' | 'snapshots' | null = null;
  let consumer: string | null = null;
  let inEdges = false;
  let dependency: string | null = null;
  for (const line of text.split(/\r?\n/)) {
    const top = line.match(/^(\S[^:]*):/);
    if (top) {
      block = top[1] === 'importers' || top[1] === 'snapshots' ? top[1] : null;
      consumer = null;
      continue;
    }
    if (block === null) continue;
    const key = line.match(/^ {2}('[^']+'|[^\s'][^:]*):/);
    if (key) {
      const id = unquote(key[1] ?? '');
      consumer = block === 'importers' ? `importer:${id}` : (id.split('(')[0] ?? id);
      inEdges = false;
      continue;
    }
    const section = line.match(/^ {4}(\w+):\s*$/);
    if (section) {
      inEdges = ['dependencies', 'devDependencies', 'optionalDependencies'].includes(section[1] ?? '');
      dependency = null;
      continue;
    }
    if (!inEdges || consumer === null) continue;
    if (block === 'snapshots') {
      const edge = line.match(/^ {6}('[^']+'|[^\s']\S*): (.+)$/);
      if (edge) record(consumer, unquote(edge[1] ?? ''), (edge[2] ?? '').trim());
    } else {
      const name = line.match(/^ {6}('[^']+'|[^\s']\S*):\s*$/);
      if (name) dependency = unquote(name[1] ?? '');
      const version = line.match(/^ {8}version: (.+)$/);
      if (version && dependency !== null) record(consumer, dependency, (version[1] ?? '').trim());
    }
  }
  return resolved;
}

/** Resolved packages, as `name -> versions`. */
export function lockfilePackages(text: string): Map<string, Set<string>> {
  const resolved = new Map<string, Set<string>>();

  let inPackages = false;
  for (const line of text.split(/\r?\n/)) {
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
