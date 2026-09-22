# ADR-022 — Core Package Client/Server Export Boundary

## Status

Accepted

## Context

[ADR-003](003-core-server-only.md) decided that `@luke/core` publishes a client-safe entry point and a separate server-only one, guarded at runtime. That decision stands and this record reaffirms it. What has drifted is its account of the mechanism.

ADR-003 describes a two-subpath `exports` map, a two-step build driven by a `packages/core/tsconfig.server.json`, and a `build:server` script. None of those exist. It also credits TypeScript with preventing a wrong import at compile time, which the package's own tsconfig explicitly says it cannot do. A record that misstates where a boundary is enforced sends the next reader to check the wrong thing.

This record supersedes ADR-003 and states the boundary in force today. The decision itself is carried forward unchanged; what is replaced is the account of how it is enforced. ADR-003 remains as the historical record of the original decision.

## Decision

### The published surface

- `@luke/core` is ESM-only (`"type": "module"`) and publishes exactly three subpaths: `.`, `./server`, and `./utils/date`.
- The build is a single `rm -rf dist && tsc`. `dist/` mirrors `src/`, so `dist/crypto/secrets.server.js` is emitted at the top level; it is not exposed as a package subpath, because no `exports` entry names it.
- `@luke/core/server` is a barrel re-exporting `./rbacConfig.js` and `../crypto/secrets.server.js`.

### Enforcement is three layers, and they are not equally strong

1. **The `exports` map**, which blocks only *unpublished* paths. `@luke/core/crypto/secrets.server` is not an importable specifier, so the module cannot be reached by a deep import. The map does **not** restrict `@luke/core/server`: that subpath is published, and therefore importable from web code like any other.
2. **The ESLint rule, which is what restricts the published subpath.** `@luke/no-restricted-module-references` forbids referencing `@luke/core/server` from web files, with `WEB_SERVER_ENTRYPOINT_IMPORTERS` — today a single file, `apps/web/src/auth.ts` — as the allowlist. The custom rule replaced ESLint's `no-restricted-imports` because that one sees only `import`/`export … from`: five of the seven static reference forms an unenrolled file can use were silent on the real config. It judges the specifier, so it needs no resolution and no build.
3. **The runtime throw**, last and weakest: `secrets.server.ts` throws when `typeof window !== 'undefined'`, and only when the module is actually evaluated.

**Core's TypeScript configuration does not enforce the client/server runtime distinction.** `packages/core/tsconfig.json` keeps `DOM` in `lib` precisely so the `typeof window` guards typecheck, and keeps `types: ["node"]` package-wide because `types` has no per-file granularity; it delegates the per-runtime split to the ESLint globals configuration. ADR-003's compile-time claim is withdrawn.

### The guard protects a module, not the server export

The throw lives in `secrets.server.ts`. `rbacConfig.ts` carries no equivalent, so `@luke/core/server` is not itself a guarded entry point: importing it fires the throw only because the barrel evaluates `secrets.server.js` as a side effect. A bundler that elides that re-export when only an `rbacConfig` symbol is used, or a future barrel that stops re-exporting it, removes the throw while leaving the import legal. For the published `./server` subpath the boundary therefore rests on the ESLint rule; the `exports` map covers only the paths that are not published, and layer 3 is a diagnostic rather than a containment mechanism.

## Consequences

- Reviewing this boundary means reviewing `WEB_SERVER_ENTRYPOINT_IMPORTERS` and the `exports` map. Enrolling a file there is the decision point, and it is deliberately a short list.
- `packages/core/test/module-contract.cjs` pins the three advertised subpaths, their resolution inside `dist`, and that the package loads as an ES-module namespace under `require()`. Its own header calls it narrow on purpose: it is not a package-boundary test and does not inspect what a client bundle contains.

### Observed gaps

These deviations exist when this record is accepted. They are recorded as follow-ups; this record does not endorse them.

- No test asserts the runtime throw. The message string occurs only in `secrets.server.ts` itself and in the two ADRs quoting it, so the one behaviour ADR-003 described as fail-fast is unverified.
- Nothing asserts that a built client bundle excludes server code. ADR-003 proposed such a check; it was never written, and `module-contract.cjs` does not cover it.
