/**
 * Executable proof of `@luke/api`'s published package contract.
 *
 * `apps/web` and `scripts/rc-prod-clone.ts` consume this package for its types
 * alone, and every one of those imports is `import type`. That makes the
 * contract unusually easy to break without noticing: nothing at runtime ever
 * loads the package, so a manifest that silently starts resolving to source
 * again would keep every consumer green while quietly pulling 129 Fastify
 * server files back into two unrelated TypeScript programs.
 *
 * Deliberately CommonJS and deliberately addressed by package name, not by
 * relative path: the self-reference is resolved by Node's own `exports`
 * machinery, so this file sees exactly what an external consumer sees. A
 * TypeScript `paths` alias cannot reach it — plain `node` reads no tsconfig —
 * which is the point, because a `paths` alias answering subpaths the `exports`
 * map does not publish is the defect an earlier cycle removed from `@luke/core`.
 *
 * Narrow on purpose, and a sibling of `packages/core/test/module-contract.cjs`
 * rather than an extension of it. That file pins an ESM-only package's
 * `require(esm)` behaviour across three subpaths; this one pins a CommonJS
 * package's single public entry and the closure of everything it refuses. The
 * two assert different things about different packages, and merging them would
 * weaken both.
 *
 * Run: `pnpm test:module-contract`
 */

const assert = require('node:assert/strict');
const path = require('node:path');

const distRoot = path.join(__dirname, '..', 'dist');

// ---------------------------------------------------------------------------
// The public entry resolves into the built contract, never into source.
// ---------------------------------------------------------------------------

const resolved = require.resolve('@luke/api');

assert.ok(
  resolved.startsWith(distRoot + path.sep),
  `@luke/api resolved to ${resolved}, outside the published dist — the exports map is being bypassed`,
);

// The type contract is what consumers actually compile against, and Node cannot
// see it: `require.resolve` follows the `default` condition. Assert the
// declaration sits beside the resolved entry, so a manifest that ships one
// without the other fails here rather than in a consumer's typecheck.
const declaration = path.join(distRoot, 'index.d.ts');
assert.ok(
  require('node:fs').existsSync(declaration),
  `${declaration} is missing — the package advertises types it did not emit. ` +
    'Without a clean, a missing declaration or an incomplete output tree can survive a rebuild; ' +
    '`pnpm --filter @luke/api build` deletes its outputs first precisely so this cannot happen.',
);

// ---------------------------------------------------------------------------
// Everything else the package contains stays private.
// ---------------------------------------------------------------------------

/**
 * Subpaths that must not resolve. `src/*` and `dist/*` both answered before the
 * `exports` map existed, which is how a consumer could reach the API's
 * implementation — and its raw TypeScript — through a package boundary that
 * looked closed.
 */
const PRIVATE_SUBPATHS = [
  '@luke/api/src/index.ts',
  '@luke/api/src/routers/index.ts',
  '@luke/api/dist/index.js',
  '@luke/api/dist/routers/index.js',
  '@luke/api/routers',
  '@luke/api/lib/auth',
];

for (const specifier of PRIVATE_SUBPATHS) {
  assert.throws(
    () => require.resolve(specifier),
    /ERR_PACKAGE_PATH_NOT_EXPORTED/,
    `${specifier} resolved, but the exports map publishes only "." and "./package.json"`,
  );
}

// `./package.json` is published on purpose: tooling that reads a manifest by
// specifier is common, and refusing it buys no isolation — the file is already
// readable by path.
assert.equal(
  require.resolve('@luke/api/package.json'),
  path.join(__dirname, '..', 'package.json'),
  '@luke/api/package.json must stay published',
);

// ---------------------------------------------------------------------------
// The entry loads. It is a type-only module, so its namespace is empty — that
// emptiness is the contract, not a failure.
// ---------------------------------------------------------------------------

const ns = require('@luke/api');

assert.deepEqual(
  Object.keys(ns).filter(k => k !== '__esModule'),
  [],
  '@luke/api exported a runtime value. The package publishes types only; a ' +
    'value here means something in the router graph is now imported at runtime ' +
    'by every consumer, apps/web included.',
);

process.stdout.write(
  `[module-contract] ok — @luke/api resolves to ${path.relative(process.cwd(), resolved)}, ` +
    `${PRIVATE_SUBPATHS.length} private subpaths refused.\n`,
);
