import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import js from '@eslint/js';
import typescript from '@typescript-eslint/eslint-plugin';
import typescriptParser from '@typescript-eslint/parser';
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import importPlugin from 'eslint-plugin-import-x';
import lukePlugin from 'eslint-plugin-luke';
import globals from 'globals';

/**
 * The web surface, and the only place framework rules may apply. Every source
 * form Next can build or import, not only TypeScript: a `page.js`, a `.jsx`
 * component or an `.mjs`/`.cjs` helper is bundled exactly like its `.tsx`
 * neighbour, and until Cycle 10 each of them sat outside the declaration and
 * server-entrypoint rules — measured on real baits, silent every time.
 */
const WEB_SOURCE_EXTENSIONS = '{ts,tsx,js,jsx,mts,cts,mjs,cjs}';
/** Production web source: what ships, and what the project's UI rules govern. */
const WEB_SOURCE_FILES = [`apps/web/src/**/*.${WEB_SOURCE_EXTENSIONS}`];
/** Playwright specs and their support files: linted, but not UI production code. */
const WEB_TEST_FILES = [`apps/web/tests/**/*.${WEB_SOURCE_EXTENSIONS}`];
/** The composed web surface for framework rules, runtime globals and the server-entrypoint boundary. */
const WEB_FILES = [...WEB_SOURCE_FILES, ...WEB_TEST_FILES];

/**
 * Every TypeScript file in every workspace: the surface the shared TypeScript
 * block below parses and applies the `@luke` plugin to. Stated once, as one
 * glob, so that any narrower glob elsewhere in this file — the test-file
 * override, the runtime classifications — is a subset by construction. The
 * previous per-directory list left `packages/<pkg>/test/`, `apps/web/e2e/` and
 * the plugin's own future TypeScript tests matching the override block but not
 * the parser block, which ESLint reports as "could not find plugin" — an
 * aborted configuration, measured on four such paths.
 */
const WORKSPACE_TS_FILES = ['{apps,packages}/**/*.{ts,tsx,mts,cts}'];

/**
 * Every tracked workspace package name, read from where it is declared:
 * `pnpm-workspace.yaml` says which directories hold workspaces, each
 * `package.json` says its name. The declaration-integrity rule judges a
 * specifier only when it addresses one of these, so the unscoped
 * `eslint-plugin-luke` is judged exactly like `@luke/core`. Fail-closed: a
 * `packages:` block that cannot be read, a glob shape this reader does not
 * understand, or an empty result throws here rather than lint with a list that
 * judges nothing.
 */
const WORKSPACE_PACKAGE_NAMES = (() => {
  const yaml = readFileSync(new URL('./pnpm-workspace.yaml', import.meta.url), 'utf8');
  const block = yaml.match(/^packages:\n((?:[ \t]+-[ \t]+.*\n)+)/m);
  if (!block) {
    throw new Error('pnpm-workspace.yaml has no `packages:` sequence; the workspace package list cannot be derived.');
  }
  const globs = block[1]
    .split('\n')
    .map((line) => line.replace(/^[ \t]+-[ \t]+/, '').trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
  const names = [];
  for (const glob of globs) {
    const segments = glob.split('/');
    if (segments.length !== 2 || segments[1] !== '*') {
      throw new Error(`pnpm-workspace.yaml glob '${glob}' is not of the form '<dir>/*'; extend this reader before linting.`);
    }
    const root = fileURLToPath(new URL(`./${segments[0]}`, import.meta.url));
    if (!existsSync(root)) continue; // `tools/*` is declared but holds no package
    for (const entry of readdirSync(root)) {
      const manifest = join(root, entry, 'package.json');
      if (!existsSync(manifest)) continue;
      const { name } = JSON.parse(readFileSync(manifest, 'utf8'));
      if (typeof name === 'string' && name.length > 0) names.push(name);
    }
  }
  if (names.length === 0) {
    throw new Error('No workspace package name could be read; refusing to lint with an empty workspace list.');
  }
  return names;
})();

/**
 * The React that `apps/web` actually resolves, read through Node from that
 * workspace rather than written down here.
 *
 * `settings.react.version` has to be set at all because `eslint-plugin-react`
 * still calls `context.getFilename()` on its `'detect'` path, removed in ESLint
 * 10 — detection throws before any rule runs. A literal would fix that and
 * create a second place React's version lives, silently wrong from the next
 * major on. Resolution is filesystem-only: no network, no new dependency, and
 * one source of truth that moves when the manifest does.
 */
const requireFromWeb = createRequire(new URL('./apps/web/package.json', import.meta.url));
let reactVersion;
try {
  reactVersion = requireFromWeb('react/package.json').version;
} catch (cause) {
  throw new Error(
    'Cannot resolve React from apps/web, so eslint-plugin-react has no version ' +
      'to work from and would crash on its detect path under ESLint 10. Install ' +
      'dependencies before linting.',
    { cause }
  );
}

/**
 * `eslint-config-next` ships flat-config arrays. `/core-web-vitals` is the
 * superset — the same entries as the bare export plus `next/core-web-vitals` —
 * and is the layer a Next application is expected to run. Two entries are taken
 * from it and re-scoped to the web surface, rather than the plugins or rule ids
 * being restated here:
 * - `next` — React, React Hooks, jsx-a11y and `@next/next` with their
 *   recommended rules;
 * - `next/core-web-vitals` — promotes `no-html-link-for-pages` and
 *   `no-sync-scripts` from warn to error. It ships with no `files` of its own,
 *   so leaving it unscoped would apply it to the whole monorepo.
 *
 * Consuming the preset this way keeps `eslint-plugin-react-hooks` out of the
 * manifests: the preset owns the instance, so the version that lints is always
 * the one Next was tested against.
 *
 * Deliberately not consumed:
 * - the `next/typescript` entry, which registers a second `@typescript-eslint`
 *   (8.62.0 against the 8.68.0 this repo pins). Two objects under one plugin
 *   key is a hard ESLint error, and the older copy would decide TS rule
 *   behaviour for `apps/web` alone;
 * - its global `ignores` entry, already covered by the ignore block below.
 *
 * Looked up by name rather than index, and fatal when absent: a preset that
 * changed shape must break the lint run, not silently deactivate the rules this
 * cycle exists to turn on.
 *
 * Deliberately carries no `languageOptions.globals`: it used to hardcode
 * `{...globals.browser, ...globals.node}` here directly, which would have
 * silently defeated Cycle 5 (P0-02b) — that cycle scopes runtime globals by
 * actual execution environment elsewhere in this file, and a flat-config file's
 * effective globals are the *union* of every block that matches it (confirmed
 * empirically, not assumed), so this block redeclaring both sets would have
 * reconstructed the exact grant Cycle 5 removes, regardless of what the later
 * blocks say. `apps/web`'s runtime-globals blocks below apply to the same
 * `WEB_FILES` and supply whatever this block used to.
 *
 * Turning these on exposed errors and warnings that were always there. No
 * severity is lowered to absorb them. Both halves are pinned at today's count
 * and can only be paid down:
 * - the errors are in `apps/web/eslint-suppressions.json`, ESLint's own bulk
 *   suppression file, listing an exact count per file per rule. One more — or a
 *   second in a file that had one — is not suppressed and fails;
 * - the warnings stay visible on every run, capped by `--max-warnings` in
 *   `apps/web`'s lint script, so they cannot quietly grow.
 * Every rule the preset ships still runs at the severity it ships with, so any
 * rule with no debt today — `rules-of-hooks` and the erroring `@next/next`
 * rules among them — already blocks on its first violation. The path to full
 * enforcement is `--prune-suppressions` and a smaller number, not a config edit.
 */
const webFrameworkBlocks = ['next', 'next/core-web-vitals'].map((entryName) => {
  const entry = nextCoreWebVitals.find((candidate) => candidate.name === entryName);
  if (!entry) {
    throw new Error(
      `eslint-config-next no longer exports a flat-config entry named '${entryName}'. ` +
        'Framework rules for apps/web would silently stop running — re-map them ' +
        'against the new shape before this passes again.'
    );
  }

  return {
    ...entry,
    name: `luke/web-${entryName.replace('/', '-')}`,
    files: WEB_FILES,
    // The preset parses with Next's Babel parser. `apps/web` is TypeScript, and
    // every rule below it — `@typescript-eslint/*` and the whole `@luke` plugin —
    // reads a TS AST. Set on each block rather than left to block ordering: a
    // parser inherited by position degrades silently, and a rule that sees the
    // wrong AST reports nothing rather than failing.
    languageOptions: {
      parser: typescriptParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
    },
    settings: {
      ...entry.settings,
      react: { version: reactVersion },
    },
  };
});

/**
 * Rules that hold for every TypeScript surface in the repo, whatever its
 * runtime. Extracted so the application block and the `tools/` control-plane
 * block below cannot drift into two different definitions of the same rule.
 */
const baseTypescriptRules = {
  'prefer-const': 'error',
  'no-var': 'error',
  'no-unused-vars': 'off', // Disabled in favor of @typescript-eslint/no-unused-vars
  '@typescript-eslint/no-unused-vars': [
    'error',
    {
      argsIgnorePattern: '^_',
      varsIgnorePattern: '^_',
      caughtErrorsIgnorePattern: '^_',
    },
  ],
  // Import ordering and management rules
  'import-x/order': [
    'error',
    {
      groups: [
        'builtin',
        'external',
        'internal',
        'parent',
        'sibling',
        'index',
        'type',
      ],
      'newlines-between': 'always',
      alphabetize: {
        order: 'asc',
        caseInsensitive: true,
      },
      pathGroups: [
        {
          pattern: '@luke/**',
          group: 'internal',
          position: 'before',
        },
        {
          pattern: '@/**',
          group: 'internal',
          position: 'before',
        },
      ],
      pathGroupsExcludedImportTypes: ['builtin'],
    },
  ],
  'import-x/no-duplicates': 'error',
  'import-x/first': 'error',
  'import-x/newline-after-import': 'error',
};

/**
 * Runtime classification (Monorepo Audit Cycle 5, P0-02b). `no-undef` is on
 * repo-wide via `js.configs.recommended`, and until this cycle every TS file in
 * the shared block below — `apps/api`, `apps/web`, and three `packages/*` —
 * received both `globals.browser` and `globals.node`, so a genuine
 * wrong-runtime reference (`window.` in a Fastify handler, `Buffer` in a React
 * component) typechecked and linted clean and would only surface at runtime.
 *
 * `languageOptions.globals` merges *cumulatively* across every flat-config
 * block that matches a file — confirmed empirically, not assumed (a later,
 * narrower block does not override an earlier broader one; it only adds to
 * it). So each of the file lists below is paired with the isomorphic blocks'
 * own `ignores`, not just given its own globals — a global grant only means
 * something if it is the *only* one a file receives beyond the base rules.
 *
 * `apps/api`, `packages/nav`, `packages/calendar`, and `packages/core/src/
 * {server,crypto}` are Node-only by hard evidence, not inference: none of them
 * reference `window`/`document` anywhere in source (verified), `packages/nav`
 * and `packages/calendar` are imported exclusively from `apps/api` (verified
 * against every import site in the workspace, never from `apps/web`), and
 * `packages/core`'s `./server` export subpath — `crypto/` is reachable only
 * through it, never through the package's own root barrel — is what makes
 * "server-only" a published contract (`@luke/core/server`, `dist/server/**`),
 * not a convention this config invented. Their own `tsconfig.json`s already
 * agree: `types: ["node"]`, and (`core`/`nav`/`calendar`, standalone configs)
 * no `dom` in `lib` at all — this file is what makes that boundary
 * enforceable at lint time instead of only at the type level.
 */
const API_NODE_FILES = [
  'apps/api/src/**/*.{ts,tsx}',
  'apps/api/test/**/*.{ts,tsx}',
  'apps/api/scripts/**/*.{ts,tsx}',
  // The seed (`tsx prisma/seed.ts`) is executable Node source that no lint
  // command reached — measured: ESLint reported every file under `prisma/` as
  // "ignored because no matching configuration was supplied".
  // `tsconfig.test.json` already typechecks it. The Prisma CLI config moved out
  // with the schema; it is covered under `packages/db` below.
  'apps/api/prisma/**/*.ts',
  'apps/api/*.mts',
];

const PACKAGE_NODE_ONLY_FILES = [
  'packages/nav/src/**/*.{ts,tsx}',
  'packages/calendar/src/**/*.{ts,tsx}',
  // `@luke/db` is Node by construction, not by inspection: its whole content is
  // a Prisma client that opens TCP sockets through `@prisma/adapter-pg`, plus
  // `__dirname`-relative paths to the schema and the migration folder. The
  // browser cannot reach it either — `apps/web` is layer 3 and `@luke/db` is
  // layer 0 with runtime `node`, so `WORKSPACE_POLICY` refuses the edge before
  // any import exists. Its Prisma CLI config sits at the package root, beside
  // `src/`, and is Node source for the same reason the seed is.
  'packages/db/src/**/*.{ts,tsx}',
  'packages/db/prisma.config.ts',
  // `@luke/core`'s server-only surface — see the export-subpath evidence above.
  'packages/core/src/server/**/*.{ts,tsx}',
  'packages/core/src/crypto/**/*.{ts,tsx}',
];

/**
 * The one cluster inside `apps/web` provably server-only by import-graph
 * evidence, not by directory convention (Next's own file-based routing gives
 * no such convention below the route-handler level — see the docstring on the
 * isomorphic web block for why the rest of `apps/web` cannot be split this
 * way). None of these paths carry `'use client'` — checked directly, not
 * inferred, since a Route Handler could not have the directive and be valid
 * either way — and every file that imports from `auth.ts` (rather than the
 * client-safe `auth.shared.ts`) is one of these files or another one already
 * in this list, confirmed by walking the import graph, not sampled.
 * The `route.ts` files under `app/api/` are Next Route Handlers: they execute
 * only on the server, by Next's own architecture, never bundled for the browser.
 */
const WEB_NODE_ONLY_FILES = [
  'apps/web/src/app/api/**/route.{ts,js}',
  'apps/web/src/auth.ts',
  'apps/web/src/auth.shared.ts',
  'apps/web/src/lib/authz/**/*.ts',
  // Next's proxy entry point (`PROXY_FILENAME` in `next/dist/lib/constants.js`).
  // On Next 16 this is not Edge middleware: `next/dist/build/analysis/
  // get-page-static-info.js` rejects a route-segment config in it with "Proxy
  // always runs on Node.js runtime", so its ambient set is Node's. Until this
  // entry it carried `globals.worker` plus `process` on the Edge premise of the
  // pre-16 middleware. Proven by bait: `Buffer` here lints clean, `window` is
  // `no-undef`. Node globals only — it is deliberately not in
  // `WEB_SERVER_ENTRYPOINT_IMPORTERS`.
  'apps/web/src/proxy.ts',
  // Node-tier unit tests — `vitest.config.mts`'s own `environment: 'node'`,
  // matched here against its exact `include` glob so the two cannot drift.
  'apps/web/src/lib/**/*.test.ts',
];

/**
 * Test-runner configuration files. They run under Node when vitest or
 * Playwright loads them, they import declared devDependencies, and until
 * Cycle 10 none of them was reached by any lint command — the `vitest*.mts`
 * and `playwright.config.ts` files sit beside `src/`, not inside it.
 */
const RUNNER_CONFIG_FILES = [
  'apps/web/*.mts',
  'apps/web/playwright.config.ts',
  'packages/*/vitest.config.mts',
];

const NODE_ONLY_FILES = [
  ...API_NODE_FILES,
  ...PACKAGE_NODE_ONLY_FILES,
  ...WEB_NODE_ONLY_FILES,
  ...RUNNER_CONFIG_FILES,
];

/**
 * The only web file that may reference `@luke/core/server`, the package's
 * published server-only entrypoint: it reads the master key from disk and
 * throws at module evaluation when `window` exists. One entry, the one real
 * importer — `auth.ts`, which declares `runtime = 'nodejs'`. This list is the
 * single authority for that boundary; the unwired
 * `tools/scripts/validate-client-server-boundaries.ts` that used to state a
 * second, contradictory one is gone.
 *
 * Deliberately narrower than `WEB_NODE_ONLY_FILES`, which classifies runtime
 * *globals* — being Node-only is not the same as having business with the
 * master key. Each candidate was mutated to import the entrypoint and judged
 * on lint and on `next build`:
 * - `lib/authz/**` imports `auth`, never the entrypoint, and needs no
 *   enrolment to keep doing so;
 * - `auth.shared.ts` is the client-safe half of the auth config. A server
 *   import there builds green (`next build` exit 0) and fails at first client
 *   use, so this rule is the only signal there is;
 * - `lib/**\/*.test.ts` runs under Node vitest. A test importing the
 *   entrypoint passed — against the real `~/.luke/secret.key` of whoever ran
 *   it, and it would create one on a CI runner;
 * - `app/api/**\/route.{ts,js}` is Node by default, but a route may export
 *   `runtime = 'edge'` and nothing here would notice. None needs the
 *   entrypoint; enrol a file here, by name, when one genuinely does;
 * - `proxy.ts` is Node (see `WEB_NODE_ONLY_FILES`) and has no such need.
 * The transitive case — a client module reaching an enrolled file — is not a
 * specifier question and is not modelled here: Turbopack refuses a Node
 * builtin in the browser layer, so `next build` fails on it, and CI runs that
 * build (`ci.yml`, "Build (web)").
 */
const WEB_SERVER_ENTRYPOINT_IMPORTERS = ['apps/web/src/auth.ts'];

/**
 * The vitest-browser tier — real Chromium via Playwright
 * (`vitest.browser.config.mts`), never Node. Verified clean of Node globals
 * (`Buffer`, `process`, `require`, `__dirname`) before narrowing, so this is
 * not expected to surface anything.
 */
const WEB_BROWSER_ONLY_FILES = ['apps/web/src/**/*.browser.test.tsx'];

export default [
  js.configs.recommended,
  ...webFrameworkBlocks,
  {
    // Every workspace TypeScript file, plus the JavaScript forms of the web
    // surface; the runtime lists below classify globals within this surface
    // and never widen it.
    files: [...WORKSPACE_TS_FILES, ...WEB_FILES],
    languageOptions: {
      parser: typescriptParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        ecmaFeatures: {
          jsx: true,
        },
      },
      // No `globals` here on purpose — see the runtime-classification comment
      // above `API_NODE_FILES`. Every file this block reaches gets its globals
      // from exactly one of the blocks below, never from here.
    },
    plugins: {
      '@typescript-eslint': typescript,
      'import-x': importPlugin,
      '@luke': lukePlugin,
    },
    rules: {
      ...baseTypescriptRules,
      '@luke/no-bare-zod-partial': 'error',
      '@luke/no-uncommented-any': 'error',
      // Workspace imports must match the importer's own manifest (Monorepo
      // Audit 6.2, declaration integrity). The rule performs no module
      // resolution, so it holds in CI's lint step, which runs before any
      // `dist` exists. Direction — which declarations are allowed at all — is
      // `WORKSPACE_POLICY` in `tools/scripts/check-platform-integrity.ts`.
      '@luke/no-undeclared-workspace-import': ['error', { workspacePackages: WORKSPACE_PACKAGE_NAMES }],
    },
  },
  {
    // Test and tooling code may load a devDependency at runtime — that is what
    // devDependencies are for. Production source may only import its types.
    //
    // Scoped to the workspace surfaces the shared block above registers the
    // `@luke` plugin for. A bare `**/*.test.ts` here also matched
    // `tools/scripts/*.test.ts`, whose block has no `@luke` plugin, and ESLint
    // then aborted `pnpm lint:tools` with "could not find plugin" — measured.
    //
    // Every glob here is a subset of `WORKSPACE_TS_FILES` by construction —
    // same roots, same extensions — so a file this block reaches always has
    // the parser and the plugin from the shared block. That is what keeps a
    // future `packages/nav/test/*.test.ts` or `apps/web/e2e/*.spec.ts` from
    // aborting the configuration instead of being linted.
    files: [
      '{apps,packages}/**/__tests__/**/*.{ts,tsx}',
      '{apps,packages}/**/*.test.{ts,tsx}',
      '{apps,packages}/**/*.spec.{ts,tsx}',
      'apps/api/test/**/*.{ts,tsx}',
      'apps/web/{tests,e2e}/**/*.{ts,tsx}',
    ],
    rules: { '@luke/no-undeclared-workspace-import': ['error', { workspacePackages: WORKSPACE_PACKAGE_NAMES, allowDevDependencies: true }] },
  },
  {
    // `@luke/core/server` may be imported only from the audited paths in
    // `WEB_SERVER_ENTRYPOINT_IMPORTERS` (see that constant for the evidence).
    // A helper elsewhere that genuinely needs it must be enrolled there — that
    // is the whole check, and it is on the specifier, so it needs no
    // resolution and no build.
    //
    // `@luke/no-restricted-module-references`, not ESLint's `no-restricted-imports`:
    // the core rule sees `import`/`export … from` only, and five of the seven
    // static forms an unenrolled file can use — `import()`, a static template
    // literal, `require()`, `import x = require()`, `import('x').T` — were
    // silent on the real config. The plugin rule judges all of them.
    files: WEB_FILES,
    ignores: WEB_SERVER_ENTRYPOINT_IMPORTERS,
    rules: {
      '@luke/no-restricted-module-references': [
        'error',
        {
          paths: [
            {
              name: '@luke/core/server',
              message:
                'Server-only: reads the master key and throws when `window` exists. Reference it only from a file listed in WEB_SERVER_ENTRYPOINT_IMPORTERS (eslint.config.mjs) — enrol the file there if it genuinely runs only on the server and needs the master key.',
            },
          ],
        },
      ],
    },
  },
  {
    // Node runtime — see the classification comment above `API_NODE_FILES`.
    // `NodeJS.Timeout`/`NodeJS.ReadableStream`-style type references also
    // appear here, hence the namespace global alongside `globals.node`.
    files: NODE_ONLY_FILES,
    languageOptions: {
      globals: {
        ...globals.node,
        NodeJS: 'readonly',
      },
    },
  },
  {
    // The package module-contract proofs — plain Node, plain CommonJS, no
    // TypeScript and no test runner.
    //
    // They have to be `.cjs` and they have to `require()` by package name:
    // that is the whole point, because resolving a package that way is the one
    // thing a TypeScript program cannot check. `tsc` reads a `paths` alias and
    // vitest reads a Vite resolver; only Node reads the `exports` map, which is
    // what `apps/web` and the containers ultimately depend on.
    //
    // Scoped to the two files by name rather than to `**/*.cjs`. A blanket
    // CommonJS grant would hand Node globals to any future `.cjs` anywhere in
    // the repository, which is the opposite of the per-runtime classification
    // the blocks above exist to enforce.
    //
    // Deliberately outside `@luke/no-undeclared-workspace-import`: each probe
    // `require()`s its own package by name, which is the self-import the rule
    // forbids everywhere else and the one thing these two files exist to do.
    files: [
      'apps/api/test/module-contract.cjs',
      'packages/core/test/module-contract.cjs',
    ],
    languageOptions: {
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
      },
    },
  },
  {
    // Browser runtime — see `WEB_BROWSER_ONLY_FILES` above.
    files: WEB_BROWSER_ONLY_FILES,
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
  },
  {
    // Isomorphic — the general `apps/web` surface. Next's own App Router makes
    // this genuinely dual-runtime at the file level, not merely an
    // under-specified config: a Client Component (`'use client'`) is still
    // server-rendered once for the initial HTML before it hydrates in the
    // browser, and a presentational component with no directive at all is
    // bundled wherever its importer places it — the *same source file* can
    // execute server-side, client-side, or both, depending on who renders it,
    // and that is a fact about the file, not a gap this config declines to
    // model. Neither `'use client'` nor Server-vs-Client status is visible to
    // a flat-config glob (it is a directive inside the file, not a path
    // convention — confirmed against this repo directly: `layout.tsx` and
    // `page.tsx` files sit on both sides of that line throughout `app/`, with
    // no directory boundary between them), so narrowing this bucket further
    // would need per-file content inspection — a custom rule, not a config
    // change, and out of this cycle's bounded scope by the audit's own
    // instruction.
    //
    // `apps/web/tests/**` (Playwright e2e) is included here for the same
    // reason as the rest, plus one of its own: `page.evaluate(() => { ... })`
    // callback bodies reference real browser globals (`localStorage`, see
    // `tests/support/smoke.ts`) from inside a file whose outer scope runs in
    // Node under the Playwright test runner — genuinely both, in the same
    // file, by design.
    //
    // Excluded (`ignores`), each already covered by a narrower block above —
    // a file must get its globals from exactly one place:
    // - `NODE_ONLY_FILES`'s web slice (route handlers, `auth.ts`,
    //   `auth.shared.ts`, `lib/authz/**`, `proxy.ts` — Node on Next 16, see
    //   its entry there — and the Node-tier unit tests);
    // - `WEB_BROWSER_ONLY_FILES` (the vitest-browser tier).
    //
    // This block itself remains the acknowledged open edge of P0-02b (Cycle
    // 5, Monorepo Audit): the same importer-dependent model that makes
    // `'use client'`/no-directive status unrepresentable by path also means
    // an undirected module here may legitimately enter either the server or
    // the client module graph depending on who imports it — a fact about the
    // file, not a gap this config declines to model. Cycle 10 split the
    // enforcement by what each layer can see: the direct import of the
    // server entrypoint is a specifier and is refused below outside
    // `WEB_SERVER_ENTRYPOINT_IMPORTERS`; the transitive graph is the
    // bundler's, and `next build` in CI ("Build (web)") is what refuses a
    // Node builtin in the browser layer. Neither is a flat-config glob.
    files: WEB_FILES,
    ignores: [...WEB_NODE_ONLY_FILES, ...WEB_BROWSER_ONLY_FILES],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        NodeJS: 'readonly',
      },
    },
  },
  // `@luke/core`'s universal surface (everything published through its root
  // export, i.e. everything outside `server/` and `crypto/`, which stay
  // Node-only via `PACKAGE_NODE_ONLY_FILES` above) is runtime-neutral by
  // default — no browser or Node ambient grant at all beyond ES built-ins.
  // "Isomorphic" does not mean "give it both complete global sets": that is
  // maximally permissive and hides exactly the wrong-runtime leakage this
  // cycle exists to catch. A grep sweep for
  // `window`/`document`/`process`/`Buffer`/`require`/`NodeJS` found two real
  // hits (a few more were prose false positives: "time window", "approval
  // window") — both named explicitly below rather than folded into a
  // package-wide grant. It did not think to also search for `URL`/
  // `URLSearchParams`, and only running `pnpm --filter @luke/core lint`
  // against the resulting neutral-by-default config actually caught that gap
  // — recorded here rather than silently patched, since it is the same kind
  // of thing a grep-only sweep will keep missing next time too.
  {
    // The one file that actually bridges Node and browser — not "a package
    // that happens to run in both", a single file deliberately written to:
    // `typeof window === 'undefined'` (×2) and `process.env.*` reads
    // (`NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_FRONTEND_URL`, `NODE_ENV`,
    // `INTERNAL_API_URL`), plus one `new URL(...)`. Granted only the
    // identifiers it actually uses, not `globals.browser`/`globals.node`
    // wholesale — a file this small, with an already-fully-enumerated need,
    // is exactly the case where identifier-level precision is honest rather
    // than paranoid, unlike the much larger, unpredictable `apps/web` bucket
    // above. `URL` is not really a Node-vs-browser question at all — see the
    // next block.
    files: ['packages/core/src/runtime/env.ts'],
    languageOptions: {
      globals: {
        window: 'readonly',
        process: 'readonly',
        URL: 'readonly',
      },
    },
  },
  {
    // `net/url.ts` — URL-building utilities, `URL`/`URLSearchParams` used
    // throughout (5 sites). Neither is a runtime-boundary question the way
    // `window` or `Buffer` is: both constructors are genuinely universal —
    // present, identically, in `globals.node` and `globals.browser` alike
    // (confirmed directly against the `globals` package, not assumed) —
    // because they are a Web-standard API Node also implements, not a
    // browser-specific one. This file has no `window`/`process`/`Buffer`
    // usage at all; granting it the full Node or browser set to reach these
    // two names would be exactly the over-grant this cycle removes elsewhere.
    files: ['packages/core/src/net/url.ts'],
    languageOptions: {
      globals: {
        URL: 'readonly',
        URLSearchParams: 'readonly',
      },
    },
  },
  {
    // `IStorageProvider`'s put/get contracts type their streams as
    // `NodeJS.ReadableStream` — a type-namespace reference, not a runtime
    // capability; the file calls no Node API. Consumed from `apps/web` too
    // (`hooks/useStorageUpload.ts`), which is exactly why it cannot be
    // Node-only: an actually-Node-only grant here would be as wrong as the
    // isomorphic one this replaces, just in the other direction. `NodeJS`
    // alone, nothing else — caught only once this cycle's stricter config
    // first ran (`pnpm --filter @luke/core lint`), not anticipated.
    files: ['packages/core/src/storage/types.ts'],
    languageOptions: {
      globals: {
        NodeJS: 'readonly',
      },
    },
  },
  {
    // Deterministic control plane. The drift checkers, the boundary validator
    // and the codemods under `tools/` are release gates — `pnpm check:drift`
    // runs them in CI and in `.husky/pre-push` — yet no lint and no typecheck
    // reached them: `tools/` is not a workspace, so `turbo run lint` never saw
    // it, and ESLint reported every file here as ignored.
    //
    // Node globals only, and a separate block rather than an entry in
    // `NODE_ONLY_FILES` above: that constant merges `globals.node` for
    // TypeScript surfaces sharing the parser/plugin setup of the big shared
    // block, which `tools/` deliberately does not (own parser options, no
    // `@luke` plugin, no JSX). These scripts run under tsx/node and never in a
    // browser, so they do not inherit browser globals.
    files: ['tools/**/*.ts'],
    languageOptions: {
      parser: typescriptParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
      },
      globals: {
        ...globals.node,
      },
    },
    plugins: {
      '@typescript-eslint': typescript,
      'import-x': importPlugin,
      '@luke': lukePlugin,
    },
    rules: {
      ...baseTypescriptRules,
      // `tools/` and `scripts/` belong to the repository root, whose manifest
      // is `tooling` in `WORKSPACE_POLICY`: it may name workspaces only under
      // `devDependencies`, and tooling loads them at runtime — `scripts/
      // rc-prod-clone.ts` imports `@trpc/client` as a value and `@luke/api`
      // as a type. So the devDependency allowance is the tooling contract
      // here, not a test-file exception; undeclared workspaces and relative
      // escapes are still refused.
      '@luke/no-undeclared-workspace-import': ['error', { workspacePackages: WORKSPACE_PACKAGE_NAMES, allowDevDependencies: true }],
    },
  },
  {
    // Repository-root operational scripts. `scripts/rc-prod-clone.ts` drives a
    // production backup/restore and was typechecked by no gate until Cycle 8
    // and linted by none until Cycle 10 (§J.4 recorded the ESLint half as
    // deferred). Same runtime and rules as `tools/`; `pnpm lint:tools` covers
    // both directories.
    files: ['scripts/**/*.ts'],
    languageOptions: {
      parser: typescriptParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
      },
      globals: {
        ...globals.node,
      },
    },
    plugins: {
      '@typescript-eslint': typescript,
      'import-x': importPlugin,
      '@luke': lukePlugin,
    },
    rules: {
      ...baseTypescriptRules,
      '@luke/no-undeclared-workspace-import': ['error', { workspacePackages: WORKSPACE_PACKAGE_NAMES, allowDevDependencies: true }],
    },
  },
  {
    // Plain-JavaScript Node code at the root and in the workspaces: the
    // release/version scripts, the Next and PostCSS configuration that
    // `next build` executes, and `eslint-plugin-luke` itself, which had no
    // lint script and so was linted by nothing. `js.configs.recommended`
    // already applies to `**/*.js`; this block adds the runtime and the
    // declaration-integrity rule. `next.config.js` is where `INTERNAL_API_URL`
    // is read, so it is executable source of the build, not decoration.
    files: [
      'scripts/**/*.{js,mjs}',
      'apps/web/*.config.js',
      'packages/eslint-plugin-luke/**/*.js',
      // The root tooling configs are executable too: this file runs on every
      // lint, `commitlint.config.js` on every commit.
      'eslint.config.mjs',
      'commitlint.config.js',
    ],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    plugins: {
      '@luke': lukePlugin,
    },
    rules: {
      '@luke/no-undeclared-workspace-import': ['error', { workspacePackages: WORKSPACE_PACKAGE_NAMES, allowDevDependencies: true }],
    },
  },
  {
    // CommonJS by format: `module.exports` / `require()` with no `"type":
    // "module"` above them. Stated so ESLint parses them as scripts rather
    // than guessing from the extension.
    files: ['scripts/**/*.js', 'apps/web/*.config.js', 'commitlint.config.js'],
    languageOptions: { sourceType: 'commonjs' },
  },
  {
    files: ['apps/api/src/**/*.{ts,tsx}'],
    rules: {
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
  {
    files: ['apps/api/src/instrument.ts'],
    rules: { 'no-console': 'off' },
  },
  {
    // The one legitimate .partial() call — implements partialWithoutDefaults() itself.
    files: ['packages/core/src/utils/zod.ts'],
    rules: { '@luke/no-bare-zod-partial': 'off' },
  },
  {
    // Test files: casting mocks (`mockPrisma.x.y as any`) is the standard vitest idiom here —
    // out of scope for the production-code `any` triage this rule backstops.
    files: [
      '**/__tests__/**/*.{ts,tsx}',
      '**/*.test.{ts,tsx}',
      '**/*.spec.{ts,tsx}',
      'apps/api/test/**/*.{ts,tsx}',
    ],
    rules: { '@luke/no-uncommented-any': 'off' },
  },
  {
    // Tailwind arbitrary-value backstop — only apps/web has Tailwind classes.
    // components/ui/** (shadcn CLI-generated) is excluded inside the rule itself.
    files: WEB_SOURCE_FILES,
    rules: { '@luke/no-uncommented-tailwind-arbitrary': 'error' },
  },
  {
    // Dialog-form backstop: keeps the ad-hoc dialog population from re-forming. Every dialog with
    // a typed field is a form; the sanctioned stack (react-hook-form + a @luke/core schema)
    // already existed while 18 dialogs quietly ignored it.
    files: WEB_SOURCE_FILES,
    rules: { '@luke/no-dialog-input-outside-form': 'error' },
  },
  {
    // Cache-invalidation backstop. A tRPC hook's query key is generated, so a hand-written one
    // never matches and the invalidation quietly does nothing — a mutation succeeds and the stale
    // row stays on screen. `trpc.useUtils()` is type-checked against the real path.
    files: WEB_SOURCE_FILES,
    rules: { '@luke/no-raw-query-client': 'error' },
  },
  {
    // Audit-metadata backstop, the static half of the `SAFE_KEY_LIST` gate. The runtime check in
    // `logAudit` sees every form, but only for code a test actually executes; this sees the two
    // forms that escape the type — a bare variable and a spread — wherever they are written.
    files: ['apps/api/src/**/*.ts'],
    rules: { '@luke/audit-metadata-object-literal': 'error' },
  },
  {
    // Disabled-tooltip backstop: a tooltip that explains why a control is disabled is worthless
    // if only the mouse can reach it. `PermissionButton` solved this once; four files
    // reimplemented the wrapper inline and dropped the tabIndex that makes it reachable.
    files: WEB_SOURCE_FILES,
    rules: { '@luke/no-unreachable-disabled-tooltip': 'error' },
  },
  {
    // crypto.randomUUID() secure-context backstop — only 'use client' files run in the
    // browser; the rule itself checks for the directive, this just scopes it to apps/web.
    files: WEB_SOURCE_FILES,
    rules: { '@luke/no-bare-client-random-uuid': 'error' },
  },
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      // The Prisma client, emitted by `prisma generate` into `@luke/db`'s
      // sources. Gitignored, rewritten on every install, and shipped with
      // `/* eslint-disable */` and `@ts-nocheck` at the top of every file — so
      // linting it can only cost 6.9MB of parsing to report nothing.
      'packages/db/src/generated/**',
      // `apps/api`'s compiled CLI scripts: build output like `dist/`, and the
      // first thing `eslint .` found once the lint command stopped naming
      // directories — 9 `no-undef` on emitted CommonJS.
      '**/dist-scripts/**',
      '**/build/**',
      '**/.next/**',
      'packages/core/src/**/*.js',
      'packages/nav/src/**/*.js',
      'packages/calendar/src/**/*.js',
      '**/.turbo/**',
      '**/*.d.ts',
      '**/*.js.map',
      '**/*.d.ts.map',
      '**/turbo.json',
      '**/pnpm-lock.yaml',
      '**/pnpm-workspace.yaml',
    ],
  },
];
