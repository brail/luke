import js from '@eslint/js';
import typescript from '@typescript-eslint/eslint-plugin';
import typescriptParser from '@typescript-eslint/parser';
import importPlugin from 'eslint-plugin-import';
import lukePlugin from './packages/eslint-plugin-luke/index.js';

export default [
  js.configs.recommended,
  {
    files: [
      'apps/api/src/**/*.{ts,tsx}',
      'apps/web/src/**/*.{ts,tsx}',
      'packages/core/src/**/*.{ts,tsx}',
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
        // Browser globals
        window: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        alert: 'readonly',
        prompt: 'readonly',
        URL: 'readonly',
        Blob: 'readonly',
        File: 'readonly',
        FileReader: 'readonly',
        EventSource: 'readonly',
        crypto: 'readonly',
        fetch: 'readonly',
        // Node.js globals
        process: 'readonly',
        Buffer: 'readonly',
        NodeJS: 'readonly',
        // HTML types
        HTMLElement: 'readonly',
        HTMLDivElement: 'readonly',
        HTMLButtonElement: 'readonly',
        HTMLInputElement: 'readonly',
        HTMLFormElement: 'readonly',
        HTMLSelectElement: 'readonly',
        HTMLTextAreaElement: 'readonly',
        HTMLTableElement: 'readonly',
        HTMLTableRowElement: 'readonly',
        HTMLTableCellElement: 'readonly',
        HTMLTableSectionElement: 'readonly',
        HTMLTableCaptionElement: 'readonly',
        HTMLOListElement: 'readonly',
        HTMLLIElement: 'readonly',
        HTMLAnchorElement: 'readonly',
        HTMLSpanElement: 'readonly',
        HTMLUListElement: 'readonly',
        HTMLHeadingElement: 'readonly',
        HTMLParagraphElement: 'readonly',
        KeyboardEvent: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': typescript,
      import: importPlugin,
      '@luke': lukePlugin,
    },
    rules: {
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
      'import/order': [
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
      'import/no-duplicates': 'error',
      'import/first': 'error',
      'import/newline-after-import': 'error',
    },
  },
  {
    files: ['apps/web/src/**/*.{ts,tsx}'],
    rules: {
      // Apply Luke-specific rules only to frontend
      // '@luke/no-hardcoded-url': 'error', // Temporarily disabled for testing
    },
  },
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/.next/**',
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
