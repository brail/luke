import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { moduleReferenceVisitors } from './lib/module-references.js';

/**
 * Dependency-declaration integrity for workspace packages: what a file
 * imports must be what its own `package.json` declares.
 *
 * This is deliberately *not* dependency direction. The rule reads only the
 * importer's manifest, so a package that edits its own manifest satisfies it —
 * measured: with `@luke/api` added to `packages/core/package.json`, this rule,
 * lint, tsc and every other gate passed. Which declarations are allowed at all
 * is a separate, normative question answered by `WORKSPACE_POLICY` in
 * `tools/scripts/check-platform-integrity.ts` (P10): layers and runtimes per
 * workspace, checked against the manifests in `check:drift`. The two compose:
 * this rule gives imports ⊆ declarations, P10 gives declarations ⊆ policy.
 *
 * What is checked, per module reference (every static form — see
 * `lib/module-references.js`):
 * - an absolute path (POSIX, Windows drive, `file:`) is refused outright;
 * - a specifier naming a workspace package — the names come from the
 *   `workspacePackages` option, which `eslint.config.mjs` reads from
 *   `pnpm-workspace.yaml` and the manifests, so the unscoped
 *   `eslint-plugin-luke` counts as much as `@luke/core` — must be under the manifest's
 *   `dependencies` or `devDependencies`; `peerDependencies` and
 *   `optionalDependencies` do not count, because the policy gives them no
 *   meaning here and P10 refuses them on the manifest side;
 * - a package declared only under `devDependencies` may be referenced as a
 *   type only — the way `apps/web` consumes `@luke/api` for `AppRouter` —
 *   unless the file is test or tooling code (`allowDevDependencies`);
 * - a package may not name itself;
 * - a relative specifier must stay lexically inside the directory of the
 *   manifest that owns the file, whatever exists at the destination. No
 *   resolution is done: the path is judged, not the file.
 *
 * Why this exists when pnpm already isolates `node_modules`: the repository
 * root declares `@luke/api` as a devDependency for `scripts/`, Node resolution
 * walks up to the root, and so every workspace can import the API today with
 * TypeScript's blessing. And why no module resolution: `pnpm lint` runs before
 * any `dist` exists in CI, so a rule that resolved specifiers to built files
 * would be silent exactly there (`import-x/no-extraneous-dependencies` is).
 */

const RUNTIME_GROUP = 'dependencies';
const TYPE_GROUP = 'devDependencies';
const UNSUPPORTED_GROUPS = ['peerDependencies', 'optionalDependencies'];

/** Nearest `package.json` above a directory, cached per directory. */
const manifestByDir = new Map();

function readManifest(manifestPath) {
  const json = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const group = (key) => (typeof json[key] === 'object' && json[key] !== null ? json[key] : {});
  return {
    path: manifestPath,
    dir: path.dirname(manifestPath),
    name: typeof json.name === 'string' ? json.name : null,
    dependencies: group(RUNTIME_GROUP),
    devDependencies: group(TYPE_GROUP),
    unsupported: Object.fromEntries(UNSUPPORTED_GROUPS.map((g) => [g, group(g)])),
  };
}

function findManifest(startDir) {
  const visited = [];
  let dir = startDir;
  let found = null;
  for (;;) {
    if (manifestByDir.has(dir)) {
      found = manifestByDir.get(dir);
      break;
    }
    visited.push(dir);
    const candidate = path.join(dir, 'package.json');
    if (existsSync(candidate)) {
      found = readManifest(candidate);
      break;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  for (const d of visited) manifestByDir.set(d, found);
  return found;
}

/**
 * The package name a bare specifier addresses: `@luke/core/server` → `@luke/core`,
 * `eslint-plugin-luke/index.js` → `eslint-plugin-luke`. Returns it only when it
 * is one of the workspace packages the config passed in — the names are read
 * from `pnpm-workspace.yaml` and the manifests by `eslint.config.mjs`, not
 * guessed from a scope, so an unscoped workspace package is judged too.
 */
function workspacePackageName(specifier, workspacePackages) {
  const parts = specifier.split('/');
  const name = specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
  return workspacePackages.has(name) ? name : null;
}

function isRelative(specifier) {
  return specifier === '.' || specifier === '..' || specifier.startsWith('./') || specifier.startsWith('../');
}

/** POSIX or Windows absolute paths, and `file:` URLs, which are absolute by definition. */
function isAbsoluteSpecifier(specifier) {
  return path.isAbsolute(specifier) || /^[A-Za-z]:[\\/]/.test(specifier) || specifier.startsWith('file:');
}

/**
 * True when `target` is `root` itself or lexically inside it. The relative
 * form escapes only when it *is* `..`, *starts with* `..` followed by a
 * separator, or is absolute (a different drive on Windows). A leading `..`
 * that is merely the start of a component name — `..foo/bar` — is inside.
 */
function contains(root, target) {
  const rel = path.relative(root, target);
  return rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require every reference to a configured workspace package (scoped or unscoped) to be declared by the nearest package.json: under dependencies, or under devDependencies for type-only use. Reject self-imports, relative paths that leave the package, and absolute specifiers.',
    },
    // Object-form schema: the options array must carry exactly one object and
    // that object must name the workspace packages. A block that forgets the
    // option is a configuration error, not a rule that silently judges nothing.
    schema: {
      type: 'array',
      minItems: 1,
      maxItems: 1,
      items: [
        {
          type: 'object',
          properties: {
            workspacePackages: {
              type: 'array',
              minItems: 1,
              uniqueItems: true,
              items: { type: 'string', minLength: 1 },
              description: 'Names of every tracked workspace package, as `eslint.config.mjs` reads them from the manifests.',
            },
            allowDevDependencies: {
              type: 'boolean',
              description:
                'Permit runtime references to packages declared only under devDependencies (test and tooling files).',
            },
          },
          required: ['workspacePackages'],
          additionalProperties: false,
        },
      ],
    },
    messages: {
      absoluteImport:
        "'{{specifier}}' is an absolute path. A module is addressed by package name or by a relative path inside its own package; an absolute path bypasses both the manifest and the exports map of whatever it lands in.",
      relativeEscape:
        "'{{specifier}}' leaves the package that owns this file ({{manifest}}). A relative path must stay inside the package directory; import another package by name so the dependency is declared and resolved through its exports map.",
      selfImport:
        "'{{specifier}}' is this package's own name. Import the module by relative path — a package cannot depend on itself.",
      undeclared:
        "'{{pkg}}' is not a dependency of {{manifest}}. A workspace may import only what its package.json declares under dependencies or devDependencies — add it there if the workspace policy (P10) allows the edge.",
      unsupportedGroup:
        "'{{pkg}}' is declared under {{group}} of {{manifest}}, which does not count: only dependencies (runtime) and devDependencies (types) declare a workspace edge here.",
      devOnlyValue:
        "'{{pkg}}' is a devDependency of {{manifest}}, so only a type reference (`import type`, `import('{{pkg}}').X`) is allowed here — a runtime reference would bundle or load it.",
    },
  },

  create(context) {
    const { workspacePackages: names, allowDevDependencies = false } = context.options[0];
    const workspacePackages = new Set(names);
    const filename = context.physicalFilename ?? context.filename;
    const manifest = path.isAbsolute(filename) ? findManifest(path.dirname(filename)) : null;
    if (!manifest) return {};

    const manifestLabel = path.relative(context.cwd, manifest.path) || manifest.path;

    return moduleReferenceVisitors(({ node, specifier, typeOnly }) => {
      if (isAbsoluteSpecifier(specifier)) {
        context.report({ node, messageId: 'absoluteImport', data: { specifier } });
        return;
      }

      if (isRelative(specifier)) {
        const landing = path.resolve(path.dirname(filename), specifier);
        if (!contains(manifest.dir, landing)) {
          context.report({ node, messageId: 'relativeEscape', data: { specifier, manifest: manifestLabel } });
        }
        return;
      }

      const pkg = workspacePackageName(specifier, workspacePackages);
      if (!pkg) return;

      if (pkg === manifest.name) {
        context.report({ node, messageId: 'selfImport', data: { specifier } });
        return;
      }

      if (pkg in manifest.dependencies) return;

      if (pkg in manifest.devDependencies) {
        if (!typeOnly && !allowDevDependencies) {
          context.report({ node, messageId: 'devOnlyValue', data: { pkg, manifest: manifestLabel } });
        }
        return;
      }

      const group = UNSUPPORTED_GROUPS.find((g) => pkg in manifest.unsupported[g]);
      if (group) {
        context.report({ node, messageId: 'unsupportedGroup', data: { pkg, group, manifest: manifestLabel } });
        return;
      }

      context.report({ node, messageId: 'undeclared', data: { pkg, manifest: manifestLabel } });
    });
  },
};
