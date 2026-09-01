/**
 * Executable proof of `@luke/core`'s published module contract.
 *
 * The package is ESM-only (`"type": "module"`), yet `apps/api` and
 * `packages/calendar` emit CommonJS and reach it through `require()`. That
 * works only because Node >= 22.12 can `require()` a *synchronous* ESM graph,
 * and only while the graph stays free of top-level `await` — a single one
 * anywhere in it makes every CommonJS consumer fail at load with
 * `ERR_REQUIRE_ASYNC_MODULE`. Nothing else in the repository exercises that
 * path: vitest, Vite and Next all load core through an ESM loader, so a
 * regression would first surface as an API container that will not boot.
 *
 * Deliberately CommonJS (`.cjs` inside an ESM package) and deliberately
 * addressed by package name, not by relative path: the self-reference is
 * resolved by the `exports` map, so this file consumes the built `dist`
 * artifact exactly as an external consumer does. A TypeScript `paths` alias
 * cannot reach it — plain `node` reads no tsconfig.
 *
 * Narrow on purpose. It pins the module format and the three advertised
 * subpaths; it is not a general package-boundary test.
 */
const assert = require('node:assert/strict');
const path = require('node:path');

const distRoot = path.join(__dirname, '..', 'dist');

/** Every subpath in the `exports` map, with one named binding that must survive the round trip. */
const SUBPATHS = [
  { specifier: '@luke/core', namedExport: 'hasPermission' },
  { specifier: '@luke/core/server', namedExport: 'getMasterKey' },
  { specifier: '@luke/core/utils/date', namedExport: 'formatDate' },
];

for (const { specifier, namedExport } of SUBPATHS) {
  const resolved = require.resolve(specifier);
  assert.ok(
    resolved.startsWith(distRoot + path.sep),
    `${specifier} resolved to ${resolved}, outside the published dist — the exports map is being bypassed`,
  );

  // Throws ERR_REQUIRE_ASYNC_MODULE if a top-level await entered this graph,
  // and ERR_REQUIRE_CYCLE_MODULE on a require-visible cycle.
  const ns = require(specifier);

  assert.equal(
    ns[Symbol.toStringTag],
    'Module',
    `${specifier} did not load as an ES module namespace — the package emitted CommonJS while advertising ESM`,
  );
  assert.equal(
    typeof ns[namedExport],
    'function',
    `${specifier} does not expose the named export ${namedExport}`,
  );
}

process.stdout.write(`[module-contract] ok — ${SUBPATHS.length} subpaths require()d from ${path.relative(process.cwd(), distRoot)} as ESM.\n`);
