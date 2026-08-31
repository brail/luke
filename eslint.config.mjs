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
      globals: {
        ...globals.browser,
        ...globals.node,
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
      globals: {
        ...globals.browser,
        ...globals.node,
        NodeJS: 'readonly',
      },
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
    // Deterministic control plane. The drift checkers, the boundary validator
    // and the codemods under `tools/` are release gates — `pnpm check:drift`
    // runs them in CI and in `.husky/pre-push` — yet no lint and no typecheck
    // reached them: `tools/` is not a workspace, so `turbo run lint` never saw
    // it, and ESLint reported every file here as ignored.
    //
    // Node globals only, and a separate block rather than an entry in the list
    // above: that block merges `globals.browser` with `globals.node` for every
    // workspace, which blunts runtime-boundary checking. These scripts run
    // under tsx/node and never in a browser, so they do not inherit it.
    // Repairing the shared block is a separate, larger change.
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
