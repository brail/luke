/**
 * The resolved packages of a v9 `pnpm-lock.yaml`, read from the keys of its
 * `packages:` block. Hand-parsed for the same reason as `pnpmWorkspace.ts`: no
 * workspace declares a YAML library.
 *
 * Shared by `check-platform-integrity` and `check-override-consumers`.
 */

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
