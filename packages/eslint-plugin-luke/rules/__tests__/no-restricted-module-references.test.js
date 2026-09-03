import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import tsParser from '@typescript-eslint/parser';
import { Linter, RuleTester } from 'eslint';

import rule from '../no-restricted-module-references.js';

RuleTester.describe = describe;
RuleTester.it = it;

const ruleTester = new RuleTester({
  languageOptions: { parser: tsParser, ecmaVersion: 'latest', sourceType: 'module' },
});

const options = [{ paths: [{ name: '@luke/core/server', message: 'server-only' }] }];
const err = [{ messageId: 'restricted' }];

ruleTester.run('no-restricted-module-references', rule, {
  valid: [
    { name: 'the package barrel is not the restricted subpath', options, code: `import { userSchema } from '@luke/core';` },
    { name: 'a sibling subpath is not restricted', options, code: `import { formatDate } from '@luke/core/utils/date';` },
    { name: 'a name that merely starts with the restricted one', options, code: `import x from '@luke/core/serverless';` },
    { name: 'dynamic import with an expression is not statically knowable', options, code: `export const f = (m) => import(m);` },
    { name: 'template literal with an expression is not judged', options, code: 'export const f = (s) => import(`@luke/core/${s}`);' },
    { name: 'require.resolve is not a module load', options, code: `const p = require.resolve('@luke/core/server');` },
  ],
  invalid: [
    { name: 'import declaration', options, code: `import { getNextAuthSecret } from '@luke/core/server';`, errors: err },
    { name: 'type-only import declaration', options, code: `import type { LukeSecrets } from '@luke/core/server';`, errors: err },
    { name: 'inline type specifiers', options, code: `import { type LukeSecrets } from '@luke/core/server';`, errors: err },
    { name: 'export from', options, code: `export { getNextAuthSecret } from '@luke/core/server';`, errors: err },
    { name: 'export star', options, code: `export * from '@luke/core/server';`, errors: err },
    { name: 'dynamic import', options, code: `export const l = () => import('@luke/core/server');`, errors: err },
    { name: 'dynamic import, static template literal', options, code: 'export const l = () => import(`@luke/core/server`);', errors: err },
    { name: 'require', options, code: `const s = require('@luke/core/server');`, errors: err },
    { name: 'require, static template literal', options, code: 'const s = require(`@luke/core/server`);', errors: err },
    { name: 'import equals require', options, code: `import s = require('@luke/core/server');`, errors: err },
    { name: 'import() type', options, code: `export type S = import('@luke/core/server').LukeSecrets;`, errors: err },
    { name: 'typeof import()', options, code: `export type S = typeof import('@luke/core/server');`, errors: err },
    { name: 'a deeper subpath of the restricted module', options, code: `import x from '@luke/core/server/index.js';`, errors: err },
  ],
});

describe('no-restricted-module-references configuration', () => {
  it('configuring the rule without its paths option is a configuration error, not a TypeError or a no-op', () => {
    const linter = new Linter({ cwd: '/x' });
    const config = {
      files: ['**/*.ts'],
      plugins: { '@luke': { rules: { r: rule } } },
      languageOptions: { parser: tsParser },
      rules: { '@luke/r': 'error' },
    };
    assert.throws(() => linter.verify(`import x from '@luke/core/server';`, config, { filename: '/x/y.ts' }), /fewer than 1 items|paths/);
  });

  it('an empty paths list is refused too', () => {
    const linter = new Linter({ cwd: '/x' });
    const config = {
      files: ['**/*.ts'],
      plugins: { '@luke': { rules: { r: rule } } },
      languageOptions: { parser: tsParser },
      rules: { '@luke/r': ['error', { paths: [] }] },
    };
    assert.throws(() => linter.verify(`export {};`, config, { filename: '/x/y.ts' }), /fewer than 1 items/);
  });
});
