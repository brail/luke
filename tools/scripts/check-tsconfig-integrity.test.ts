/**
 * Behavioral proof for `check-tsconfig-integrity.ts`.
 *
 * A checker that has only ever been seen green is assumed to block, not known
 * to. Each case here materializes a throwaway git repository, breaks exactly one
 * architectural property, and asserts the corresponding invariant goes red.
 *
 * Both directions are covered on purpose. The expensive failure mode of a gate
 * is not the violation it misses but the correct architecture it rejects: a rule
 * that reports legitimate configuration as broken gets disabled within a week
 * (`lessons.md`, "A new lint rule must be probed on a bait file"). So the
 * deliberate asymmetries — Vitest owning the API test runtime, `packages/core`
 * carrying DOM because it is genuinely isomorphic, a test project extending the
 * project it tests rather than the base — are asserted to stay green with the
 * same weight as the violations are asserted to fail.
 *
 * Run: `pnpm test:tools`
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';

import {
  VALID_REPO,
  withCompilerOptions,
  withFile,
  withoutFile,
  type RepoFiles,
} from './__fixtures__/tsconfig/validRepo';
import { checkTsconfigIntegrity } from './check-tsconfig-integrity';

const created: string[] = [];

after(() => {
  for (const dir of created) rmSync(dir, { recursive: true, force: true });
});

/**
 * Materialize files into a real git repository.
 *
 * git and not a bare directory because the checker discovers configs with
 * `git ls-files`: that is deliberate — a gate must reason about tracked state
 * rather than whatever happens to sit on the disk — so the fixtures have to
 * offer it a repository to read.
 */
function repo(files: RepoFiles, links: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'luke-tsconfig-'));
  created.push(dir);

  for (const [path, contents] of Object.entries(files)) {
    const full = join(dir, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, contents);
  }

  // pnpm links every workspace dependency into its consumer's `node_modules`,
  // so a fixture that only writes files cannot reproduce the shape the
  // symlink-bypass rule exists to catch.
  for (const [path, target] of Object.entries(links)) {
    const full = join(dir, path);
    mkdirSync(dirname(full), { recursive: true });
    symlinkSync(target, full);
  }

  const git = (...args: string[]): void => {
    execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
  };
  git('init', '-q');
  git('config', 'user.email', 'fixture@example.invalid');
  git('config', 'user.name', 'fixture');
  git('add', '-A');

  return dir;
}

/** The invariant is violated: at least one problem matches. */
function expectFailure(files: RepoFiles, pattern: RegExp): void {
  const problems = checkTsconfigIntegrity(repo(files));
  const matched = problems.filter(p => pattern.test(p.message));
  assert.ok(
    matched.length > 0,
    `expected a problem matching ${pattern}, got:\n` +
      (problems.map(p => `  - ${p.file}: ${p.message}`).join('\n') || '  (none)')
  );
}

/** The configuration is legitimate: nothing is reported at all. */
function expectClean(files: RepoFiles): void {
  const problems = checkTsconfigIntegrity(repo(files));
  assert.deepEqual(
    problems.map(p => `${p.file}: ${p.message}`),
    [],
    'expected no problems'
  );
}

// ---------------------------------------------------------------------------
// The baseline must be clean, or every negative case below proves nothing.
// ---------------------------------------------------------------------------

test('baseline fixture satisfies every invariant', () => {
  expectClean(VALID_REPO);
});

test('zero-discovery: a tree with no tracked config throws rather than passing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'luke-tsconfig-empty-'));
  created.push(dir);
  execFileSync('git', ['init', '-q'], { cwd: dir, stdio: 'ignore' });
  assert.throws(() => checkTsconfigIntegrity(dir), /no tracked tsconfig/);
});

// ---------------------------------------------------------------------------
// Classification closes in both directions
// ---------------------------------------------------------------------------

test('an unclassified config fails rather than escaping the policy', () => {
  expectFailure(
    withFile(
      'packages/reporting/tsconfig.json',
      '{ "extends": "../../tsconfig.base.json" }\n'
    ),
    /unclassified TypeScript config/
  );
});

test('a classified config that no longer exists fails rather than looking covered', () => {
  expectFailure(withoutFile('packages/nav/tsconfig.json'), /but not tracked/);
});

// ---------------------------------------------------------------------------
// Runtime globals
// ---------------------------------------------------------------------------

test('a Node surface that asks for DOM is rejected', () => {
  expectFailure(
    withCompilerOptions('apps/api/tsconfig.json', { lib: ['ES2022', 'DOM'] }),
    /Node-only surface configuring browser libraries/
  );
});

test('a Node library that asks for DOM is rejected', () => {
  expectFailure(
    withCompilerOptions('packages/calendar/tsconfig.json', {
      lib: ['ES2022', 'DOM'],
    }),
    /Node-only surface configuring browser libraries/
  );
});

test('the Node tooling surface is covered by the same rule', () => {
  expectFailure(
    withCompilerOptions('tools/tsconfig.json', { lib: ['ES2022', 'WebWorker'] }),
    /Node-only surface configuring browser libraries/
  );
});

test('a Node surface inherits its parent\'s DOM, and is reported for it', () => {
  // `apps/api/tsconfig.test.json` declares no `lib` of its own. The rule reads
  // the resolved options, so a parent's DOM reaches it — which is exactly how
  // every Node config in this repository had DOM without mentioning it.
  const problems = checkTsconfigIntegrity(
    repo(withCompilerOptions('apps/api/tsconfig.json', { lib: ['ES2022', 'DOM'] }))
  );
  const files = problems
    .filter(p => /Node-only surface configuring browser libraries/.test(p.message))
    .map(p => p.file);
  assert.ok(
    files.includes('apps/api/tsconfig.test.json'),
    `expected the inheriting config to be reported too, got: ${files.join(', ')}`
  );
});

test('an unset `lib` fails: the TypeScript default is not neutral, it is DOM', () => {
  expectFailure(
    withFile(
      'tsconfig.base.json',
      '{ "compilerOptions": { "target": "ES2022", "strict": true } }\n'
    ),
    /no configured `lib`/
  );
});

test('the web surface must keep DOM', () => {
  expectFailure(
    withCompilerOptions('apps/web/tsconfig.json', { lib: ['ES2022'] }),
    /web surface configuring no DOM library/
  );
});

test('the isomorphic package must keep the DOM its `typeof window` guards need', () => {
  expectFailure(
    withCompilerOptions('packages/core/tsconfig.json', { lib: ['ES2022'] }),
    /isomorphic surface without lib\.dom\.d\.ts/
  );
});

test('the isomorphic exception is narrow: more than DOM is rejected', () => {
  expectFailure(
    withCompilerOptions('packages/core/tsconfig.json', {
      lib: ['ES2022', 'DOM', 'DOM.Iterable', 'ScriptHost'],
    }),
    /more than the justified DOM exception/
  );
});

test('the neutral base may not carry a runtime', () => {
  expectFailure(
    withFile(
      'tsconfig.base.json',
      '{ "compilerOptions": { "target": "ES2022", "lib": ["ES2022", "DOM"] } }\n'
    ),
    /neutral base is not runtime-free/
  );
});

// ---------------------------------------------------------------------------
// JSX and the Next plugin
// ---------------------------------------------------------------------------

test('JSX on a Node surface is rejected', () => {
  expectFailure(
    withCompilerOptions('apps/api/tsconfig.json', { jsx: 'preserve' }),
    /non-web surface configuring `jsx`/
  );
});

test('the Next plugin on a Node surface is rejected', () => {
  expectFailure(
    withCompilerOptions('packages/nav/tsconfig.json', {
      plugins: [{ name: 'next' }],
    }),
    /non-web surface carrying the Next TypeScript plugin/
  );
});

test('the web surface must keep JSX and the Next plugin', () => {
  expectFailure(
    withCompilerOptions('apps/web/tsconfig.json', { jsx: undefined }),
    /web surface without `jsx`/
  );
});

// ---------------------------------------------------------------------------
// Module resolution
// ---------------------------------------------------------------------------

test('a Node package silently moved onto bundler resolution is rejected', () => {
  expectFailure(
    withCompilerOptions('packages/core/tsconfig.json', {
      module: 'ESNext',
      moduleResolution: 'Bundler',
    }),
    /not on NodeNext/
  );
});

test('the bundler exception is scoped to the API test config, not to Node siblings', () => {
  // Discriminating, not decorative: the same ESNext/Bundler pair that is
  // correct for the Vitest-loaded API tests must fail on a Node-loaded sibling.
  // Delete the `node-bundler` branch and this case reports the API test config
  // too; widen it to every `*.test.json` and the calendar mutation goes green.
  const problems = checkTsconfigIntegrity(
    repo(
      withCompilerOptions('packages/calendar/tsconfig.test.json', {
        module: 'ESNext',
        moduleResolution: 'Bundler',
      })
    )
  );
  const offenders = problems
    .filter(p => /not on NodeNext/.test(p.message))
    .map(p => p.file);
  assert.deepEqual(offenders, ['packages/calendar/tsconfig.test.json']);
});

test('the API test config moved off bundler resolution is rejected', () => {
  expectFailure(
    withCompilerOptions('apps/api/tsconfig.test.json', {
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
    }),
    /bundler-loaded surface not using/
  );
});

test('the neutral base may not pick a module system for everyone', () => {
  expectFailure(
    withFile(
      'tsconfig.base.json',
      '{ "compilerOptions": { "target": "ES2022", "lib": ["ES2022"], "module": "NodeNext" } }\n'
    ),
    /neutral base sets `module`/
  );
});

// ---------------------------------------------------------------------------
// Package boundaries
// ---------------------------------------------------------------------------

test('a workspace package aliased onto another workspace source is rejected', () => {
  expectFailure(
    withCompilerOptions('apps/api/tsconfig.json', {
      paths: { '@luke/core': ['../../packages/core/src'] },
    }),
    /bypassing that package's `exports` map/
  );
});

test('the wildcard form, which type-resolves unpublished subpaths, is rejected', () => {
  expectFailure(
    withCompilerOptions('apps/api/tsconfig.json', {
      paths: { '@luke/core/*': ['../../packages/core/src/*'] },
    }),
    /ERR_PACKAGE_PATH_NOT_EXPORTED/
  );
});

test('an alias declared in a parent is caught in the child that inherits it', () => {
  const problems = checkTsconfigIntegrity(
    repo(
      withCompilerOptions('apps/api/tsconfig.json', {
        paths: { '@luke/core': ['../../packages/core/src'] },
      })
    )
  );
  const files = problems
    .filter(p => /bypassing that package/.test(p.message))
    .map(p => p.file);
  assert.ok(
    files.includes('apps/api/tsconfig.test.json'),
    `expected the inheriting config to be reported too, got: ${files.join(', ')}`
  );
});

test('the rule is structural: a non-package alias key into workspace source also fails', () => {
  // Renaming the key must buy no amnesty. `core-src/*` is not a package name,
  // so a rule written against `@luke/` prefixes would call this compliant while
  // it bypasses the exports map exactly as the old alias did.
  expectFailure(
    withCompilerOptions('apps/api/tsconfig.json', {
      paths: { 'core-src/*': ['../../packages/core/src/*'] },
    }),
    /`core-src\/\*` reaches into packages\/core/
  );
});

test('a project reference into another package is rejected, not only a paths alias', () => {
  // `references` outranks `paths`: this is the door the alias rule does not
  // cover, and closing only one of the two leaves the boundary half-open.
  expectFailure(
    withFile(
      'apps/api/tsconfig.json',
      JSON.stringify({
        extends: '../../tsconfig.base.json',
        compilerOptions: {
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          types: ['node'],
        },
        include: ['src/**/*'],
        references: [{ path: '../../packages/core' }],
      })
    ),
    /project reference into packages\/core/
  );
});

test('a local alias inside the config\'s own package stays green', () => {
  // `apps/web`'s `@/*` -> `./src/*` is ordinary and must not be swept up by the
  // structural rule; the baseline already carries it, asserted here explicitly.
  const problems = checkTsconfigIntegrity(repo(VALID_REPO));
  assert.deepEqual(
    problems.filter(p => /reaches into|project reference into/.test(p.message)),
    []
  );
});

test('a non-workspace alias is legitimate and stays green', () => {
  expectClean({
    ...withCompilerOptions('apps/api/tsconfig.json', {
      paths: { 'pdfmake/interfaces': ['./node_modules/@types/pdfmake/interfaces.d.ts'] },
    }),
    // The target has to exist: an alias into `node_modules` that resolves to
    // nothing is deliberately unverifiable rather than assumed external.
    'apps/api/node_modules/@types/pdfmake/interfaces.d.ts':
      'export declare const x: number;\n',
  });
});

// ---------------------------------------------------------------------------
// The extends chain
// ---------------------------------------------------------------------------

test('a config that no longer reaches the neutral base is rejected', () => {
  expectFailure(
    withFile(
      'packages/nav/tsconfig.json',
      '{ "compilerOptions": { "lib": ["ES2022"], "module": "NodeNext", "moduleResolution": "NodeNext" } }\n'
    ),
    /does not reach tsconfig\.base\.json/
  );
});

test('inheritance is followed transitively, two hops from the base', () => {
  // `packages/core/tsconfig.test.json` never names the base; it reaches it only
  // through `packages/core/tsconfig.json`. Break the middle link and the leaf
  // must be reported — which only happens if the chain is genuinely walked
  // rather than the leaf's own `extends` string being matched.
  const problems = checkTsconfigIntegrity(
    repo(
      withFile(
        'packages/core/tsconfig.json',
        '{ "compilerOptions": { "lib": ["ES2022", "DOM"], "module": "NodeNext", "moduleResolution": "NodeNext" } }\n'
      )
    )
  );
  const offenders = problems
    .filter(p => /does not reach tsconfig\.base\.json/.test(p.message))
    .map(p => p.file)
    .sort();
  assert.deepEqual(offenders, [
    'packages/core/tsconfig.json',
    'packages/core/tsconfig.test.json',
  ]);
});

test('an `extends` pointing at a file that does not exist is rejected', () => {
  expectFailure(
    withFile(
      'packages/nav/tsconfig.json',
      '{ "extends": "../../tsconfig.missing.json" }\n'
    ),
    /does not exist/
  );
});

test('a circular `extends` chain is reported rather than hanging the gate', () => {
  expectFailure(
    {
      ...VALID_REPO,
      'packages/nav/tsconfig.json': '{ "extends": "./tsconfig.loop.json" }\n',
      'packages/nav/tsconfig.loop.json': '{ "extends": "./tsconfig.json" }\n',
    },
    /circular `extends` chain/
  );
});

test('an extensionless relative `extends` is resolved, not reported as missing', () => {
  expectClean(
    withFile(
      'packages/nav/tsconfig.json',
      JSON.stringify({
        extends: '../../tsconfig.base',
        compilerOptions: {
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          types: ['node'],
        },
        include: ['src/**/*'],
      })
    )
  );
});

test('an `extends` array reaches the base through any of its entries', () => {
  // The intermediate file is itself an unclassified config, which fails closed
  // by design — so this asserts on the reachability verdict for the governed
  // config rather than on a clean tree.
  const problems = checkTsconfigIntegrity(
    repo({
      ...VALID_REPO,
      'packages/nav/tsconfig.local.json':
        '{ "compilerOptions": { "types": ["node"] } }\n',
      'packages/nav/tsconfig.json': JSON.stringify({
        extends: ['./tsconfig.local.json', '../../tsconfig.base.json'],
        compilerOptions: {
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
        },
        include: ['src/**/*'],
      }),
    })
  );
  assert.deepEqual(
    problems
      .filter(p => p.file === 'packages/nav/tsconfig.json')
      .map(p => p.message),
    [],
    'the array form must resolve, and its neutral lib must be inherited'
  );
});

test('a package-specifier `extends` is rejected by provenance, not mislabelled as unreachable', () => {
  const problems = checkTsconfigIntegrity(
    repo(
      withFile(
        'packages/nav/tsconfig.json',
        '{ "extends": "@tsconfig/node24/tsconfig.json" }\n'
      )
    )
  );
  const messages = problems
    .filter(p => p.file === 'packages/nav/tsconfig.json')
    .map(p => p.message);
  assert.ok(
    messages.some(m => /provenance this gate cannot verify/.test(m)),
    `expected a provenance diagnostic, got:\n${messages.join('\n')}`
  );
});

test('a malformed parent reports its own parse error, on its own file', () => {
  const problems = checkTsconfigIntegrity(
    repo(withFile('tsconfig.base.json', '{ "compilerOptions": { "lib": [ }\n'))
  );
  const parseProblems = problems.filter(p => /cannot be parsed/.test(p.message));
  assert.ok(
    parseProblems.length > 0,
    `expected a parse diagnostic, got:\n${problems.map(p => `  ${p.file}: ${p.message}`).join('\n')}`
  );
  assert.deepEqual(
    [...new Set(parseProblems.map(p => p.file))],
    ['tsconfig.base.json'],
    'the parse error must be attributed to the malformed file, not to its children'
  );
});

// ---------------------------------------------------------------------------
// Where an alias really lands
//
// A lexical rule reads `apps/api/node_modules/@luke/core` as "inside apps/api"
// and waves through the exact bypass this gate exists to stop, because pnpm
// links that name straight back to `packages/core`.
// ---------------------------------------------------------------------------

test('an alias through a pnpm workspace symlink is caught, not classified same-package', () => {
  const problems = checkTsconfigIntegrity(
    repo(
      withCompilerOptions('apps/api/tsconfig.json', {
        paths: { '@luke/core/*': ['./node_modules/@luke/core/src/*'] },
      }),
      { 'apps/api/node_modules/@luke/core': '../../../../packages/core' }
    )
  );
  assert.ok(
    problems.some(
      p =>
        p.file === 'apps/api/tsconfig.json' &&
        /reaches into packages\/core/.test(p.message)
    ),
    `expected the symlinked target to be reported, got:\n${problems.map(p => `  ${p.file}: ${p.message}`).join('\n')}`
  );
});

test('an alias to a genuine external dependency stays green', () => {
  expectClean({
    ...withCompilerOptions('apps/api/tsconfig.json', {
      paths: { ext: ['../../node_modules/ext'] },
    }),
    'node_modules/ext/index.d.ts': 'export declare const x: number;\n',
  });
});

test('a package-local node_modules type alias stays green', () => {
  expectClean({
    ...withCompilerOptions('apps/api/tsconfig.json', {
      paths: { 'ext/types': ['./node_modules/@types/ext/index.d.ts'] },
    }),
    'apps/api/node_modules/@types/ext/index.d.ts': 'export declare const x: number;\n',
  });
});

test('an alias into node_modules that does not exist fails closed, unverifiable', () => {
  expectFailure(
    withCompilerOptions('apps/api/tsconfig.json', {
      paths: { '@luke/core/*': ['./node_modules/@luke/core/src/*'] },
    }),
    /cannot tell a workspace link from an external dependency/
  );
});

// ---------------------------------------------------------------------------
// Root file ownership
// ---------------------------------------------------------------------------

test('an `include` reaching another package\'s sources is rejected', () => {
  expectFailure(
    withFile(
      'apps/api/tsconfig.json',
      JSON.stringify({
        extends: '../../tsconfig.base.json',
        compilerOptions: {
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          types: ['node'],
        },
        include: ['src/**/*', '../../packages/core/src/**/*'],
      })
    ),
    /selects root files owned by packages\/core/
  );
});

test('a `files` entry pointing at another package is rejected', () => {
  expectFailure(
    withFile(
      'apps/api/tsconfig.json',
      JSON.stringify({
        extends: '../../tsconfig.base.json',
        compilerOptions: {
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          types: ['node'],
        },
        files: ['src/index.ts', '../../packages/core/src/index.ts'],
      })
    ),
    /selects root files owned by packages\/core/
  );
});

test('the rule reads root files, not imports: an ordinary local include is clean', () => {
  // The distinction matters beyond tidiness. `apps/web` pulls 129 `apps/api`
  // source files through `@luke/api`'s manifest, and this rule must not report
  // that — it is a package-contract residual, not a root-file violation. Luke's
  // own tree is the standing proof: `pnpm check:tsconfig` is green there.
  expectClean(VALID_REPO);
});

// ---------------------------------------------------------------------------
// Project naming convention
// ---------------------------------------------------------------------------

test('a script compiling a non-canonical project name is rejected', () => {
  expectFailure(
    {
      ...VALID_REPO,
      'apps/api/ts.build.json': '{ "extends": "./tsconfig.json" }\n',
      'apps/api/package.json': JSON.stringify({
        name: '@fixture/api',
        private: true,
        scripts: { build: 'tsc -p ts.build.json' },
      }),
    },
    /whose name is outside the `tsconfig\*\.json` convention/
  );
});

test('an unreferenced JSON file that is not a project is ignored', () => {
  expectClean({
    ...VALID_REPO,
    'apps/api/some-tool.json': '{ "compilerOptions": { "strict": true } }\n',
  });
});

test('a canonical tsconfig.build.json participates in discovery and must be classified', () => {
  expectFailure(
    {
      ...VALID_REPO,
      'packages/nav/tsconfig.build.json': '{ "extends": "./tsconfig.json" }\n',
    },
    /unclassified TypeScript config/
  );
});

test('a script compiling an untracked canonical project is rejected', () => {
  const files = {
    ...VALID_REPO,
    'apps/api/package.json': JSON.stringify({
      name: '@fixture/api',
      private: true,
      scripts: { build: 'tsc -p tsconfig.missing.json' },
    }),
  };
  expectFailure(files, /which is not tracked by git/);
});

// ---------------------------------------------------------------------------
// Extends: diamonds are not cycles
// ---------------------------------------------------------------------------

test('a diamond in an `extends` array is not a cycle', () => {
  const problems = checkTsconfigIntegrity(
    repo({
      ...VALID_REPO,
      'packages/nav/tsconfig.local.json':
        '{ "extends": "../../tsconfig.base.json", "compilerOptions": { "types": ["node"] } }\n',
      'packages/nav/tsconfig.json': JSON.stringify({
        extends: ['./tsconfig.local.json', '../../tsconfig.base.json'],
        compilerOptions: { module: 'NodeNext', moduleResolution: 'NodeNext' },
        include: ['src/**/*'],
      }),
    })
  );
  assert.deepEqual(
    problems
      .filter(p => p.file === 'packages/nav/tsconfig.json')
      .map(p => p.message),
    [],
    'both branches reach the base; revisiting it is a diamond, not a cycle'
  );
});

test('a nested true cycle still fails, attributed to the config that closes it', () => {
  const problems = checkTsconfigIntegrity(
    repo({
      ...VALID_REPO,
      'packages/nav/tsconfig.json': '{ "extends": "./tsconfig.a.json" }\n',
      'packages/nav/tsconfig.a.json': '{ "extends": "./tsconfig.b.json" }\n',
      'packages/nav/tsconfig.b.json': '{ "extends": "./tsconfig.json" }\n',
    })
  );
  const cycles = problems.filter(p => /circular `extends` chain/.test(p.message));
  assert.ok(cycles.length > 0, 'expected a cycle diagnostic');
  assert.deepEqual(
    [...new Set(cycles.map(p => p.file))],
    ['packages/nav/tsconfig.b.json'],
    'the cycle belongs to the config that closes the loop'
  );
});

test('a missing parent several levels deep is attributed to the config that names it', () => {
  const problems = checkTsconfigIntegrity(
    repo({
      ...VALID_REPO,
      'packages/nav/tsconfig.json': '{ "extends": "./tsconfig.a.json" }\n',
      'packages/nav/tsconfig.a.json': '{ "extends": "./tsconfig.gone.json" }\n',
    })
  );
  const missing = problems.filter(p => /which does not exist/.test(p.message));
  assert.deepEqual(
    [...new Set(missing.map(p => p.file))],
    ['packages/nav/tsconfig.a.json'],
    'the leaf did not name the bad edge; its grandparent did'
  );
});

// ---------------------------------------------------------------------------
// Next plugin
// ---------------------------------------------------------------------------

test('the web surface without the Next plugin is rejected', () => {
  const web = JSON.parse(VALID_REPO['apps/web/tsconfig.json']) as {
    compilerOptions: Record<string, unknown>;
  };
  delete web.compilerOptions.plugins;
  expectFailure(
    withFile('apps/web/tsconfig.json', JSON.stringify(web)),
    /web surface without the Next TypeScript plugin/
  );
});

test('an `extends` edge onto a non-canonical config name is reported', () => {
  // Discovery is `tsconfig*.json`; a chain that reaches outside that convention
  // pulls options from a file no classification rule will ever see.
  expectFailure(
    {
      ...VALID_REPO,
      'packages/nav/ts.shared.json':
        '{ "extends": "../../tsconfig.base.json", "compilerOptions": { "types": ["node"] } }\n',
      'packages/nav/tsconfig.json': JSON.stringify({
        extends: './ts.shared.json',
        compilerOptions: { module: 'NodeNext', moduleResolution: 'NodeNext' },
        include: ['src/**/*'],
      }),
    },
    /does not follow the `tsconfig\*\.json` naming convention/
  );
});
