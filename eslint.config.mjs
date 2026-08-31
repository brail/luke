import { createRequire } from 'node:module';

import js from '@eslint/js';
import typescript from '@typescript-eslint/eslint-plugin';
import typescriptParser from '@typescript-eslint/parser';
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import importPlugin from 'eslint-plugin-import-x';
import lukePlugin from 'eslint-plugin-luke';
import globals from 'globals';

/** The web surface, and the only place framework rules may apply. */
const WEB_FILES = ['apps/web/src/**/*.{ts,tsx}', 'apps/web/tests/**/*.{ts,tsx}'];

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
];

const PACKAGE_NODE_ONLY_FILES = [
  'packages/nav/src/**/*.{ts,tsx}',
  'packages/calendar/src/**/*.{ts,tsx}',
  // `@luke/core`'s server-only surface — see the export-subpath evidence above.
  'packages/core/src/server/**/*.{ts,tsx}',
  'packages/core/src/crypto/**/*.{ts,tsx}',
];

/**
 * The one cluster inside `apps/web` provably server-only by import-graph
 * evidence, not by directory convention (Next's own file-based routing gives
 * no such convention below the route-handler level — see the docstring on the
 * isomorphic web block for why the rest of `apps/web` cannot be split this
 * way). None of these five paths carry `'use client'` — checked directly, not
 * inferred, since a Route Handler could not have the directive and be valid
 * either way — and every file that imports from `auth.ts` (rather than the
 * client-safe `auth.shared.ts`) is one of these files or another one already
 * in this list, confirmed by walking the import graph, not sampled.
 * The `route.ts` files under `app/api/` are Next Route Handlers: they execute
 * only on the server, by Next's own architecture, never bundled for the browser.
 */
const WEB_NODE_ONLY_FILES = [
  'apps/web/src/app/api/**/route.ts',
  'apps/web/src/auth.ts',
  'apps/web/src/auth.shared.ts',
  'apps/web/src/lib/authz/**/*.ts',
  // Node-tier unit tests — `vitest.config.mts`'s own `environment: 'node'`,
  // matched here against its exact `include` glob so the two cannot drift.
  'apps/web/src/lib/**/*.test.ts',
];

const NODE_ONLY_FILES = [...API_NODE_FILES, ...PACKAGE_NODE_ONLY_FILES, ...WEB_NODE_ONLY_FILES];

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
    files: [
      'apps/api/src/**/*.{ts,tsx}',
      'apps/api/test/**/*.{ts,tsx}',
      'apps/api/scripts/**/*.{ts,tsx}',
      'apps/web/src/**/*.{ts,tsx}',
      'apps/web/tests/**/*.{ts,tsx}',
      'packages/core/src/**/*.{ts,tsx}',
      'packages/nav/src/**/*.{ts,tsx}',
      'packages/calendar/src/**/*.{ts,tsx}',
    ],
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
    // Excluded (`ignores`), each already covered by a narrower block above or
    // needing none at all — a file must get its globals from exactly one
    // place:
    // - `NODE_ONLY_FILES`'s web slice (route handlers, `auth.ts`,
    //   `auth.shared.ts`, `lib/authz/**`, the Node-tier unit tests);
    // - `WEB_BROWSER_ONLY_FILES` (the vitest-browser tier);
    // - `proxy.ts` — Next's Edge middleware entry point (`PROXY_FILENAME` in
    //   `next/dist/lib/constants.js`; the file itself calls it "Edge
    //   middleware" too), which has its own dedicated block below — Edge is
    //   neither Node nor a full browser and gets neither's ambient set here.
    //
    // This block itself remains the acknowledged open edge of P0-02b (Cycle
    // 5, Monorepo Audit): the same importer-dependent model that makes
    // `'use client'`/no-directive status unrepresentable by path also means
    // an undirected module here may legitimately enter either the server or
    // the client module graph depending on who imports it — a fact about the
    // file, not a gap this config declines to model. Closing it needs a
    // different enforcement layer (import-graph-aware tooling, or Next's own
    // `server-only`/`client-only` build-time markers), evaluated and
    // deliberately deferred — not attempted here, and not something a
    // flat-config glob can express on its own.
    files: ['apps/web/src/**/*.{ts,tsx}', 'apps/web/tests/**/*.{ts,tsx}'],
    ignores: [...WEB_NODE_ONLY_FILES, ...WEB_BROWSER_ONLY_FILES, 'apps/web/src/proxy.ts'],
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
    // `apps/web/src/proxy.ts` — Next's Edge middleware/proxy entry point
    // (`PROXY_FILENAME` in `next/dist/lib/constants.js`). Edge is a real,
    // distinct third runtime, not "neither Node nor browser" left
    // unspecified: read Next's own `next/dist/server/web/globals.js`
    // directly rather than guessing. Its `enhanceGlobals()` runs only when
    // `NEXT_RUNTIME === 'edge'` and explicitly installs a `process` object
    // (`global.process = process`, syncing `.env`) — Edge genuinely gets a
    // `process`, just not the full Node one. Cross-checked
    // `next/dist/server/web/adapter.js`, the actual Edge sandbox, for
    // `URL`/`Headers`/`fetch`/`crypto` — all present there, and all present
    // in the `globals` package's own `worker` preset (already a dependency,
    // nothing new to install), which correctly excludes `window`/`document`
    // (no DOM) and `Buffer`/`require`/`__dirname`/`module` (no Node) while
    // including the Web-standard surface Edge actually has. `worker` plus
    // one evidenced addition (`process`) — not a hand-maintained Edge-global
    // list, and not the false-conservative "grant nothing" this replaced.
    files: ['apps/web/src/proxy.ts'],
    languageOptions: {
      globals: {
        ...globals.worker,
        process: 'readonly',
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
    },
    rules: baseTypescriptRules,
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
    files: ['apps/web/src/**/*.{ts,tsx}'],
    rules: { '@luke/no-uncommented-tailwind-arbitrary': 'error' },
  },
  {
    // Dialog-form backstop: keeps the ad-hoc dialog population from re-forming. Every dialog with
    // a typed field is a form; the sanctioned stack (react-hook-form + a @luke/core schema)
    // already existed while 18 dialogs quietly ignored it.
    files: ['apps/web/src/**/*.{ts,tsx}'],
    rules: { '@luke/no-dialog-input-outside-form': 'error' },
  },
  {
    // Cache-invalidation backstop. A tRPC hook's query key is generated, so a hand-written one
    // never matches and the invalidation quietly does nothing — a mutation succeeds and the stale
    // row stays on screen. `trpc.useUtils()` is type-checked against the real path.
    files: ['apps/web/src/**/*.{ts,tsx}'],
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
    files: ['apps/web/src/**/*.{ts,tsx}'],
    rules: { '@luke/no-unreachable-disabled-tooltip': 'error' },
  },
  {
    // crypto.randomUUID() secure-context backstop — only 'use client' files run in the
    // browser; the rule itself checks for the directive, this just scopes it to apps/web.
    files: ['apps/web/src/**/*.{ts,tsx}'],
    rules: { '@luke/no-bare-client-random-uuid': 'error' },
  },
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/.next/**',
      'packages/core/src/**/*.js',
      'packages/nav/src/**/*.js',
      'packages/calendar/src/**/*.js',
      '**/.turbo/**',
      '**/*.d.ts',
      '**/*.js.map',
      '**/*.d.ts.map',
      '**/next.config.js',
      '**/postcss.config.js',
      '**/tailwind.config.js',
      '**/eslint.config.js',
      '**/.eslintrc.js',
      '**/turbo.json',
      '**/pnpm-lock.yaml',
      '**/pnpm-workspace.yaml',
    ],
  },
];
