import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import tsParser from '@typescript-eslint/parser';
import { Linter, RuleTester } from 'eslint';

import rule from '../no-undeclared-workspace-import.js';

// RuleTester looks for global `describe`/`it`; under `node --test` they are importable but not
// global, so hand them over explicitly — otherwise every case collapses into one opaque file-level
// failure instead of being reported per case.
RuleTester.describe = describe;
RuleTester.it = it;

const ruleTester = new RuleTester({
  languageOptions: { parser: tsParser, ecmaVersion: 'latest', sourceType: 'module' },
});

/**
 * A miniature workspace whose manifests are the whole allowed graph: web → core (dependency),
 * web → api (devDependency, types only); api → core, nav; core → nothing; the unscoped
 * `eslint-plugin-luke` as tooling; and a repository root that, like the real one, declares
 * `@luke/api` and the plugin for its scripts.
 *
 * Materialized in a temporary directory rather than committed as fixture files: the platform
 * checker discovers manifests with `git ls-files '*package.json'`, so a tracked fixture manifest
 * would be read as a real workspace when that checker runs against Luke itself.
 */
const FIX = mkdtempSync(path.join(tmpdir(), 'luke-workspace-graph-'));
const manifests = {
  'package.json': {
    name: 'fixture-root',
    private: true,
    devDependencies: { '@luke/api': 'workspace:*', 'eslint-plugin-luke': 'workspace:*' },
  },
  'apps/web/package.json': {
    name: '@luke/web',
    dependencies: { '@luke/core': 'workspace:*' },
    devDependencies: { '@luke/api': 'workspace:*' },
  },
  'apps/api/package.json': {
    name: '@luke/api',
    dependencies: { '@luke/core': 'workspace:*', '@luke/nav': 'workspace:*' },
    optionalDependencies: { '@luke/calendar': 'workspace:*' },
  },
  'packages/core/package.json': { name: '@luke/core', dependencies: { zod: '^4' }, peerDependencies: { '@luke/nav': 'workspace:*' } },
  'packages/nav/package.json': { name: '@luke/nav', dependencies: { '@luke/core': 'workspace:*' } },
  'packages/calendar/package.json': { name: '@luke/calendar', dependencies: { '@luke/core': 'workspace:*' } },
  'packages/eslint-plugin-luke/package.json': { name: 'eslint-plugin-luke', devDependencies: { eslint: '^10' } },
};
for (const [rel, json] of Object.entries(manifests)) {
  const full = path.join(FIX, rel);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, JSON.stringify(json, null, 2));
}
after(() => rmSync(FIX, { recursive: true, force: true }));

// What `eslint.config.mjs` passes for real: every workspace package name, the unscoped one included.
const WORKSPACE = Object.values(manifests).map((m) => m.name).filter((n) => n !== 'fixture-root');
const withOptions = (cases) =>
  cases.map((c) => ({ ...c, options: [{ workspacePackages: WORKSPACE, ...(c.options?.[0] ?? {}) }] }));

const WEB = path.join(FIX, 'apps/web/src/lib/thing.ts');
const WEB_TEST = path.join(FIX, 'apps/web/src/lib/__tests__/thing.test.ts');
const API = path.join(FIX, 'apps/api/src/routers/thing.ts');
const CORE = path.join(FIX, 'packages/core/src/schemas/thing.ts');
const ROOT_SCRIPT = path.join(FIX, 'scripts/thing.ts');
const PLUGIN = path.join(FIX, 'packages/eslint-plugin-luke/rules/thing.js');

ruleTester.run('no-undeclared-workspace-import', rule, {
  valid: withOptions([
    { name: 'declared dependency', filename: WEB, code: `import { userSchema } from '@luke/core';` },
    { name: 'declared dependency, subpath', filename: WEB, code: `import { formatDate } from '@luke/core/utils/date';` },
    { name: 'devDependency as import type', filename: WEB, code: `import type { AppRouter } from '@luke/api';` },
    { name: 'devDependency as a type-only default import', filename: WEB, code: `import type api from '@luke/api';` },
    { name: 'devDependency as a type-only namespace import', filename: WEB, code: `import type * as api from '@luke/api';` },
    {
      name: 'devDependency with every specifier inline type',
      filename: WEB,
      code: `import { type AppRouter, type RouterOutputs } from '@luke/api';`,
    },
    { name: 'devDependency as export type', filename: WEB, code: `export type { AppRouter } from '@luke/api';` },
    {
      name: 'devDependency as a value in a test file when allowed',
      filename: WEB_TEST,
      options: [{ allowDevDependencies: true }],
      code: `import { appRouter } from '@luke/api';`,
    },
    {
      name: 'api reaches its declared libraries',
      filename: API,
      code: `import { a } from '@luke/core'; import { b } from '@luke/nav'; import { c } from '@luke/core/server';`,
    },
    { name: 'relative import inside the same package', filename: WEB, code: `import { cn } from './utils';` },
    { name: 'relative import climbing within the same package', filename: WEB, code: `import { auth } from '../auth';` },
    { name: 'path alias is not a workspace specifier', filename: WEB, code: `import { cn } from '@/lib/utils';` },
    { name: 'third-party scoped package is out of scope', filename: WEB, code: `import { z } from '@tanstack/react-query';` },
    { name: 'third-party unscoped package is out of scope', filename: WEB, code: `import leftPad from 'left-pad';` },
    { name: 'non-literal dynamic import is not judged', filename: CORE, code: `export const f = (m) => import(m);` },
    { name: 'no manifest above the file: rule stands down', filename: '/nonexistent/anywhere/x.ts', code: `import { a } from '@luke/api';` },
    { name: 'relative filename (RuleTester default) stands down', code: `import { a } from '@luke/api';` },
    { name: 'root script may import the root devDependency as a type', filename: ROOT_SCRIPT, code: `import type { AppRouter } from '@luke/api';` },
    {
      name: 'root tooling may load the unscoped plugin at runtime when allowed',
      filename: ROOT_SCRIPT,
      options: [{ allowDevDependencies: true }],
      code: `import plugin from 'eslint-plugin-luke';`,
    },
    { name: 'devDependency through an import() type', filename: WEB, code: `export type R = import('@luke/api').AppRouter;` },
    { name: 'devDependency through typeof import()', filename: WEB, code: `export type M = typeof import('@luke/api');` },
    { name: 'declared dependency through a static template literal import()', filename: WEB, code: `export const load = () => import(\`@luke/core\`);` },
    { name: 'declared dependency through a static template literal require()', filename: API, code: `const core = require(\`@luke/core\`);` },
    { name: 'template literal with an expression is not statically knowable: not judged', filename: CORE, code: `export const f = (n) => import(\`@luke/\${n}\`);` },
    { name: 'relative path that climbs and comes back inside the package', filename: WEB, code: `import { x } from '../../src/lib/other';` },
    { name: 'relative path to a file that does not exist but is inside the package', filename: WEB, code: `import { x } from './not-there-yet';` },
    { name: 'the package directory itself', filename: WEB, code: `import { x } from '../..';` },
    { name: 'a component whose name starts with two dots is inside, not an escape', filename: WEB, code: `import { x } from './..foo/bar';` },
    { name: 'climbing to the package root and into a dot-dot-named component', filename: WEB, code: `import { x } from '../../..foo';` },
  ]),
  invalid: withOptions([
    {
      name: 'core → api: resolvable through the root devDependency, but not declared by core',
      filename: CORE,
      code: `import { appRouter } from '@luke/api';`,
      errors: [{ messageId: 'undeclared' }],
    },
    {
      name: 'core → api even as a type: a declaration dependency is still a dependency',
      filename: CORE,
      code: `import type { AppRouter } from '@luke/api';`,
      errors: [{ messageId: 'undeclared' }],
    },
    { name: 'core → web: never declared anywhere', filename: CORE, code: `import w from '@luke/web';`, errors: [{ messageId: 'undeclared' }] },
    {
      name: 'core imports itself by package name',
      filename: CORE,
      code: `import { userSchema } from '@luke/core';`,
      errors: [{ messageId: 'selfImport' }],
    },
    { name: 'api → web', filename: API, code: `import w from '@luke/web';`, errors: [{ messageId: 'undeclared' }] },
    {
      name: 'web → api as a value import',
      filename: WEB,
      code: `import { appRouter } from '@luke/api';`,
      errors: [{ messageId: 'devOnlyValue' }],
    },
    { name: 'web → api as a default import', filename: WEB, code: `import api from '@luke/api';`, errors: [{ messageId: 'devOnlyValue' }] },
    { name: 'web → api as a namespace import', filename: WEB, code: `import * as api from '@luke/api';`, errors: [{ messageId: 'devOnlyValue' }] },
    { name: 'web → api as a side-effect import', filename: WEB, code: `import '@luke/api';`, errors: [{ messageId: 'devOnlyValue' }] },
    {
      name: 'web → api mixed: one value specifier is enough',
      filename: WEB,
      code: `import { type AppRouter, appRouter } from '@luke/api';`,
      errors: [{ messageId: 'devOnlyValue' }],
    },
    {
      name: 'web → api as a value re-export',
      filename: WEB,
      code: `export { appRouter } from '@luke/api';`,
      errors: [{ messageId: 'devOnlyValue' }],
    },
    { name: 'web → api as export *', filename: WEB, code: `export * from '@luke/api';`, errors: [{ messageId: 'devOnlyValue' }] },
    {
      name: 'web → api through import()',
      filename: WEB,
      code: `export const load = () => import('@luke/api');`,
      errors: [{ messageId: 'devOnlyValue' }],
    },
    {
      name: 'web → api through require()',
      filename: WEB,
      code: `const api = require('@luke/api');`,
      errors: [{ messageId: 'devOnlyValue' }],
    },
    {
      name: 'web → api through import = require',
      filename: WEB,
      code: `import api = require('@luke/api');`,
      errors: [{ messageId: 'devOnlyValue' }],
    },
    { name: 'web → nav: never declared', filename: WEB, code: `import { syncAll } from '@luke/nav';`, errors: [{ messageId: 'undeclared' }] },
    {
      name: 'the unscoped workspace package is judged like a scoped one: web does not declare it',
      filename: WEB,
      code: `import plugin from 'eslint-plugin-luke';`,
      errors: [{ messageId: 'undeclared', data: { pkg: 'eslint-plugin-luke', manifest: path.relative(process.cwd(), path.join(FIX, 'apps/web/package.json')) } }],
    },
    {
      name: 'the unscoped workspace package by subpath',
      filename: WEB,
      code: `import rule from 'eslint-plugin-luke/rules/no-uncommented-any.js';`,
      errors: [{ messageId: 'undeclared' }],
    },
    {
      name: 'root script loads the unscoped plugin at runtime without the allowance',
      filename: ROOT_SCRIPT,
      code: `import plugin from 'eslint-plugin-luke';`,
      errors: [{ messageId: 'devOnlyValue' }],
    },
    {
      name: 'the plugin imports itself by name',
      filename: PLUGIN,
      code: `import plugin from 'eslint-plugin-luke';`,
      errors: [{ messageId: 'selfImport' }],
    },
    {
      name: 'relative path escaping into another package',
      filename: WEB,
      code: `import { userSchema } from '../../../../packages/core/src/schemas/user';`,
      errors: [{ messageId: 'relativeEscape' }],
    },
    {
      name: 'relative escape via a re-export',
      filename: API,
      code: `export * from '../../../packages/core/src/index';`,
      errors: [{ messageId: 'relativeEscape' }],
    },
    {
      name: 'test file without the allowance still forbids a devDependency value import',
      filename: WEB_TEST,
      code: `import { appRouter } from '@luke/api';`,
      errors: [{ messageId: 'devOnlyValue' }],
    },
    {
      name: 'undeclared package through an import() type is still undeclared',
      filename: CORE,
      code: `export type R = import('@luke/api').AppRouter;`,
      errors: [{ messageId: 'undeclared' }],
    },
    {
      name: 'undeclared package through typeof import()',
      filename: CORE,
      code: `export type M = typeof import('@luke/api');`,
      errors: [{ messageId: 'undeclared' }],
    },
    {
      name: 'undeclared package through a static template literal import()',
      filename: CORE,
      code: `export const load = () => import(\`@luke/api\`);`,
      errors: [{ messageId: 'undeclared' }],
    },
    {
      name: 'devDependency loaded through a static template literal require()',
      filename: WEB,
      code: `const api = require(\`@luke/api\`);`,
      errors: [{ messageId: 'devOnlyValue' }],
    },
    {
      name: 'peerDependencies do not declare a workspace edge (core → nav is declared only there)',
      filename: CORE,
      code: `import { syncAll } from '@luke/nav';`,
      errors: [{ messageId: 'unsupportedGroup', data: { pkg: '@luke/nav', group: 'peerDependencies', manifest: path.relative(process.cwd(), path.join(FIX, 'packages/core/package.json')) } }],
    },
    {
      name: 'optionalDependencies do not declare a workspace edge, even for a type',
      filename: API,
      code: `import type { X } from '@luke/calendar';`,
      errors: [{ messageId: 'unsupportedGroup' }],
    },
    {
      name: 'relative escape to a path outside the repository with no manifest anywhere above it',
      filename: WEB,
      code: `import { x } from '../../../../../../../../../../nowhere/at/all';`,
      errors: [{ messageId: 'relativeEscape' }],
    },
    {
      name: 'relative escape to a sibling directory with no manifest',
      filename: WEB,
      code: `import { x } from '../../../not-a-package/thing';`,
      errors: [{ messageId: 'relativeEscape' }],
    },
    {
      name: 'relative escape one level above the package root',
      filename: WEB,
      code: `import { x } from '../../../';`,
      errors: [{ messageId: 'relativeEscape' }],
    },
    {
      name: 'a dot-dot-named component outside the package root is still an escape',
      filename: WEB,
      code: `import { x } from '../../../..foo/bar';`,
      errors: [{ messageId: 'relativeEscape' }],
    },
    {
      name: 'exactly the parent of the package root',
      filename: WEB,
      code: `import { x } from '../../..';`,
      errors: [{ messageId: 'relativeEscape' }],
    },
    {
      name: 'relative escape through import()',
      filename: API,
      code: `export const l = () => import('../../../packages/core/src/index');`,
      errors: [{ messageId: 'relativeEscape' }],
    },
    {
      name: 'absolute POSIX path, even into a declared package',
      filename: WEB,
      code: `import { userSchema } from '${path.join(FIX, 'packages/core/src/schemas/user')}';`,
      errors: [{ messageId: 'absoluteImport' }],
    },
    {
      name: 'absolute path inside the importing package is refused too',
      filename: WEB,
      code: `import { cn } from '${path.join(FIX, 'apps/web/src/lib/utils')}';`,
      errors: [{ messageId: 'absoluteImport' }],
    },
    {
      name: 'file: URL through import()',
      filename: WEB,
      code: `export const l = () => import('file:///${path.join(FIX, 'packages/core/src/index.js').replace(/^\//, '')}');`,
      errors: [{ messageId: 'absoluteImport' }],
    },
    {
      name: 'Windows drive path',
      filename: WEB,
      code: `import x from 'C:\\\\repo\\\\packages\\\\core\\\\src\\\\x';`,
      errors: [{ messageId: 'absoluteImport' }],
    },
  ]),
});

describe('no-undeclared-workspace-import configuration', () => {
  it('a block that configures the rule without workspacePackages is a configuration error, not a silent rule', () => {
    const linter = new Linter({ cwd: FIX });
    const config = {
      files: ['**/*.ts'],
      plugins: { '@luke': { rules: { r: rule } } },
      languageOptions: { parser: tsParser },
      rules: { '@luke/r': 'error' },
    };
    assert.throws(() => linter.verify(`import { a } from '@luke/api';`, config, { filename: WEB }), /fewer than 1 items|workspacePackages/);
  });
});
