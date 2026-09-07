#!/usr/bin/env node

/**
 * Write one version into every package.json of the monorepo.
 *
 * A writer, and nothing else. It used to have a read mode as well — `--check`,
 * which compared the manifests against `git describe --tags --abbrev=0` — and
 * that mode answered the wrong question: `git describe` returns the
 * topologically *nearest* tag, not the tag anyone is releasing. A second tag on
 * the same commit made it fail a correct tree, an annotated sibling took
 * precedence over a lightweight one, pushing an older still-correct tag after
 * HEAD had moved on failed a legitimate push, and with no tag reachable it
 * compared against `0.0.0-<branch>`. There was no way to bind it to a tag:
 * `--check` took no version and was declared incompatible with `--set`.
 *
 * Verifying that a tree claims a version is now
 * `tools/scripts/check-release-tree.ts`, which is told the tag explicitly and
 * reads the tree that tag names. Nothing under `scripts/` or `.husky/` calls
 * `git describe` any more.
 *
 * Usage: node scripts/sync-version.js --set 1.11.0
 *
 * Called by `scripts/release-prepare.sh` with the version the operator named,
 * once `check-release-train.ts --validate` has approved it.
 */

const fs = require('fs');
const path = require('path');

/**
 * Package.json files to write, **derived from the workspace layout** rather
 * than listed.
 *
 * A hand-written list fails asymmetrically: an extra entry is noticed at once
 * (file not found), a *missing* one is not. `packages/calendar` was created
 * without being added here and stayed at `1.10.0-dev.0` while the check
 * reported OK — green on a monorepo that was out of sync.
 *
 * The groups below mirror the `packages:` globs in `pnpm-workspace.yaml`
 * (`apps/*`, `packages/*`) without reading them. That is a second definition
 * and it is deliberate for now: `check-release-tree.ts` *does* read the YAML,
 * from the released tree, and rejects a glob that discovers no manifest — so a
 * third glob added to the workspace and missed here fails at prepare time
 * rather than shipping a stale version. Reading the YAML from this CommonJS
 * writer is a small follow-up if that ever happens.
 */
function discoverPackages() {
  const root = path.join(__dirname, '..');
  const found = ['package.json']; // the root is part of the monorepo

  for (const group of ['apps', 'packages']) {
    const dir = path.join(root, group);
    if (!fs.existsSync(dir)) continue;

    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const rel = `${group}/${entry.name}/package.json`;
      if (fs.existsSync(path.join(root, rel))) found.push(rel);
    }
  }

  // Zero-discovery guard: if the layout changes and the groups above find
  // nothing, this script would become a silent no-op.
  if (found.length < 2) {
    throw new Error(
      `Found only ${found.length} package.json under apps/ and packages/. ` +
        'The monorepo layout has changed: update discoverPackages().'
    );
  }

  return found.sort();
}

/**
 * The version to write. Required: this script has no way to work out which
 * release is being prepared, and every caller already knows.
 */
const setIndex = process.argv.indexOf('--set');
const version =
  setIndex !== -1 ? process.argv[setIndex + 1]?.replace(/^v/, '') : undefined;

if (setIndex === -1) {
  console.error('❌ `--set <version>` is required. Example: --set 1.11.0');
  console.error(
    '   Preparing a release? Use `pnpm release:prepare <tag>` instead.'
  );
  process.exit(1);
}
if (!version) {
  console.error('❌ `--set` requires a version. Example: --set 1.11.0');
  process.exit(1);
}
if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) {
  console.error(`❌ "${version}" is not a valid semver version (X.Y.Z[-pre]).`);
  process.exit(1);
}

console.log(`📌 Requested version: ${version}`);

for (const pkgPath of discoverPackages()) {
  const fullPath = path.join(__dirname, '..', pkgPath);

  // Named per file: a malformed manifest is the failure worth reporting here,
  // and a bare stack trace does not say which of the eight it was.
  try {
    const pkg = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));

    if (pkg.version === version) {
      console.log(`✔️  ${pkgPath}: already at ${version}`);
      continue;
    }

    pkg.version = version;
    fs.writeFileSync(fullPath, JSON.stringify(pkg, null, 2) + '\n');
    console.log(`✅ ${pkgPath}: updated to ${version}`);
  } catch (err) {
    console.error(`❌ ${pkgPath}: ${err.message}`);
    process.exit(1);
  }
}
