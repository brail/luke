import js from '@eslint/js';
import typescript from '@typescript-eslint/eslint-plugin';
import typescriptParser from '@typescript-eslint/parser';
import importPlugin from 'eslint-plugin-import-x';
import lukePlugin from 'eslint-plugin-luke';
import globals from 'globals';

export default [
  js.configs.recommended,
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
      'prefer-const': 'error',
      'no-var': 'error',
      '@luke/no-bare-zod-partial': 'error',
      '@luke/no-uncommented-any': 'error',
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
    },
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
