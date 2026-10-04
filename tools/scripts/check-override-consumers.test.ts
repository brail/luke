/**
 * `check-override-consumers` against throwaway repositories with a fake pnpm virtual store: each
 * case writes the overrides, the lockfile, the store's copy of it and the installed packages'
 * manifests, then asks the checker. The store is untracked on purpose — it is what the checker reads.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';

import { checkOverrideConsumers } from './check-override-consumers';

interface Installed {
  name: string;
  version: string;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
  bundleDependencies?: string[];
  /** In the store but not in the lockfile: a leftover of an older install. */
  stale?: boolean;
  /** What the lockfile resolved each dependency to, as `snapshots:` writes it. */
  resolved?: Record<string, string>;
}

interface Fixture {
  overrides: Record<string, string>;
  installed?: Installed[];
  devDependencies?: Record<string, string>;
  /** What the lockfile resolved the root workspace's devDependencies to (`importers:`). */
  rootResolved?: Record<string, string>;
  /** `missing`: no virtual store at all; `stale`: its lock copy differs from pnpm-lock.yaml. */
  store?: 'ok' | 'missing' | 'stale';
}

const created: string[] = [];
after(() => {
  for (const dir of created) rmSync(dir, { recursive: true, force: true });
});

function write(root: string, path: string, contents: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), contents);
}

function repo({ overrides, installed = [], devDependencies = {}, rootResolved = {}, store = 'ok' }: Fixture): string {
  const root = mkdtempSync(join(tmpdir(), 'luke-overrides-'));
  created.push(root);

  const workspace =
    'packages:\n  - apps/*\n\noverrides:\n' +
    Object.entries(overrides)
      .map(([key, value]) => `  # GHSA-ggr8-5vv4-36mx\n  '${key}': '${value}'`)
      .join('\n') +
    '\n';
  const locked = installed.filter(p => !p.stale);
  const importer = Object.entries(rootResolved)
    .map(([dep, version]) => `      ${dep}:\n        specifier: ${devDependencies[dep] ?? '*'}\n        version: ${version}\n`)
    .join('');
  const lock =
    "lockfileVersion: '9.0'\n\nimporters:\n\n  .:\n" +
    (importer ? `    devDependencies:\n${importer}` : '') +
    '\npackages:\n\n' +
    locked.map(p => `  '${p.name}@${p.version}':\n    resolution: {integrity: sha512-x}\n`).join('\n') +
    '\nsnapshots:\n\n' +
    locked
      .map(p => {
        const deps = Object.entries(p.resolved ?? {});
        const body = deps.length ? `\n    dependencies:\n${deps.map(([d, v]) => `      '${d}': ${v}\n`).join('')}` : ' {}\n';
        return `  '${p.name}@${p.version}':${body}`;
      })
      .join('\n');

  write(root, '.gitignore', 'node_modules/\n');
  write(root, 'package.json', JSON.stringify({ name: 'root', private: true, devDependencies }, null, 2));
  write(root, 'pnpm-workspace.yaml', workspace);
  write(root, 'pnpm-lock.yaml', lock);

  if (store !== 'missing') {
    write(root, 'node_modules/.pnpm/lock.yaml', store === 'stale' ? `${lock}# drifted\n` : lock);
    for (const { stale: _stale, ...manifest } of installed) {
      const id = `${manifest.name.replace('/', '+')}@${manifest.version}`;
      write(root, `node_modules/.pnpm/${id}/node_modules/${manifest.name}/package.json`, JSON.stringify(manifest));
    }
  }

  const git = (...args: string[]): void => {
    execFileSync('git', args, { cwd: root, stdio: 'ignore' });
  };
  git('init', '-q');
  git('add', '-A');
  return root;
}

function expectRefused(fixture: Fixture, pattern: RegExp): void {
  const problems = checkOverrideConsumers(repo(fixture));
  assert.ok(
    problems.some(p => pattern.test(p.message)),
    `expected a problem matching ${pattern}, got:\n` + (problems.map(p => `  - ${p.message}`).join('\n') || '  (none)')
  );
}

function expectClean(fixture: Fixture): void {
  assert.deepEqual(checkOverrideConsumers(repo(fixture)).map(p => p.message), []);
}

const stringify = (version: string, dependencies: Record<string, string>): Installed => ({
  name: 'fast-json-stringify',
  version,
  dependencies,
});

test('refuses the X3 cap: an override below what a consumer declares', () => {
  expectRefused(
    { overrides: { 'fast-uri': '>=3.1.6 <4' }, installed: [stringify('7.0.1', { 'fast-uri': '^4.0.0' })] },
    /`fast-uri` \(`>=3\.1\.6 <4`\) is entirely below .*fast-json-stringify@7\.0\.1.*`\^4\.0\.0`/
  );
});

test('accepts an override that lifts a consumer above its own range', () => {
  expectClean({
    overrides: {
      'deepmerge-ts': '>=8.0.2',
      'uuid@<11.1.1': '>=11.1.1',
      'brace-expansion': '>=5.0.12 <6',
      mysql2: '>=3.23.1 <4',
      '@opentelemetry/propagator-jaeger': '>=2.9.0 <2.10.0',
    },
    installed: [
      { name: '@prisma/config', version: '7.10.0', dependencies: { 'deepmerge-ts': '7.1.5' } },
      { name: 'exceljs', version: '4.4.0', dependencies: { uuid: '^8.3.0' } },
      { name: 'minimatch', version: '3.1.5', dependencies: { 'brace-expansion': '^1.1.7' } },
      { name: 'prisma', version: '7.10.0', dependencies: { mysql2: '3.15.3' } },
      { name: '@opentelemetry/sdk-node', version: '0.219.0', dependencies: { '@opentelemetry/propagator-jaeger': '2.8.0' } },
    ],
  });
});

test('reads a workspace devDependency, which pnpm overrides too', () => {
  expectRefused({ overrides: { 'fast-uri': '>=3.1.6 <4' }, devDependencies: { 'fast-uri': '^4.0.0' } }, /root.*`\^4\.0\.0`/);
});

test('applies a selector override only where the selector meets the declared range', () => {
  expectClean({ overrides: { 'fast-uri@<4': '>=3.1.6 <4' }, installed: [stringify('7.0.1', { 'fast-uri': '^4.0.0' })] });
});

test('takes the least satisfiable branch of a `||` range', () => {
  expectRefused(
    { overrides: { 'fast-uri': '>=3.1.6 <4' }, installed: [stringify('7.0.1', { 'fast-uri': '>=2 <1 || ^4.0.0' })] },
    /is entirely below/
  );
});

test('sees a prerelease floor above the cap', () => {
  expectRefused(
    { overrides: { 'fast-uri': '>=3.1.6 <4' }, installed: [stringify('7.0.1', { 'fast-uri': '^4.0.0-beta.1' })] },
    /is entirely below/
  );
});

test('reads the range of an npm alias under the name pnpm overrides', () => {
  expectRefused(
    { overrides: { 'fast-uri': '>=3.1.6 <4' }, installed: [stringify('7.0.1', { 'fast-uri': 'npm:fast-uri@^4.0.0' })] },
    /is entirely below/
  );
});

test('reads peers and says when one is optional', () => {
  expectRefused(
    {
      overrides: { 'fast-uri': '>=3.1.6 <4' },
      installed: [
        {
          name: 'plugin',
          version: '1.0.0',
          peerDependencies: { 'fast-uri': '^4.0.0' },
          peerDependenciesMeta: { 'fast-uri': { optional: true } },
        },
      ],
    },
    /an optional peer/
  );
});

test('skips an edge the consumer bundles: the override does not reach it', () => {
  expectClean({
    overrides: { 'fast-uri': '>=3.1.6 <4' },
    installed: [{ ...stringify('7.0.1', { 'fast-uri': '^4.0.0' }), bundleDependencies: ['fast-uri'] }],
  });
});

test('ignores a store directory the current lockfile does not resolve', () => {
  expectClean({
    overrides: { 'fast-uri': '>=3.1.6 <4' },
    installed: [{ ...stringify('7.0.1', { 'fast-uri': '^4.0.0' }), stale: true }],
  });
});

test('skips workspace and link specifiers', () => {
  expectClean({
    overrides: { 'fast-uri': '>=3.1.6 <4' },
    installed: [stringify('7.0.1', { 'fast-uri': 'workspace:*' }), stringify('7.0.2', { 'fast-uri': 'link:../x' })],
  });
});

test('reports a declared range it cannot evaluate instead of passing it', () => {
  expectRefused(
    { overrides: { 'fast-uri': '>=3.1.6 <4' }, installed: [stringify('7.0.1', { 'fast-uri': 'latest' })] },
    /cannot evaluate .*`latest`/
  );
});

test('refuses to run on a missing or stale install', () => {
  expectRefused({ overrides: { 'fast-uri': '>=3.1.6 <4' }, store: 'missing' }, /install is missing or stale/);
  expectRefused({ overrides: { 'fast-uri': '>=3.1.6 <4' }, store: 'stale' }, /install is missing or stale/);
});

test('keeps a prerelease-only branch of the target, which semver.minVersion cannot place', () => {
  expectClean({
    overrides: { 'fast-uri': '>=3.1.6 <4 || >4.0.0 <4.0.1-beta' },
    installed: [stringify('7.0.1', { 'fast-uri': '^4.0.0' })],
  });
});

test('reports a declared range whose least version it cannot place, instead of passing it', () => {
  expectRefused(
    { overrides: { 'fast-uri': '>=3.1.6 <4' }, installed: [stringify('7.0.1', { 'fast-uri': '>4.0.0 <4.0.1-beta' })] },
    /cannot evaluate .*`>4\.0\.0 <4\.0\.1-beta`/
  );
});

test('refuses a target with a branch that admits no version', () => {
  expectRefused(
    { overrides: { 'fast-uri': '>=3.1.6 <4 || >=9 <8' }, installed: [stringify('7.0.1', { 'fast-uri': '^4.0.0' })] },
    /`fast-uri`: its target .* has a branch that admits no version/
  );
});

test('matches a selector against the original specifier, as pnpm does: an alias never matches', () => {
  expectClean({
    overrides: { 'fast-uri@^4': '>=3.1.6 <4' },
    installed: [stringify('7.0.1', { 'fast-uri': 'npm:fast-uri@^4.0.0' })],
  });
});

test('does not evaluate a tag a selector override would not reach', () => {
  expectClean({ overrides: { 'fast-uri@<4': '>=3.1.6 <4' }, installed: [stringify('7.0.1', { 'fast-uri': 'latest' })] });
});

test('a bundle covers dependencies only, never a peer', () => {
  expectRefused(
    {
      overrides: { 'fast-uri': '>=3.1.6 <4' },
      installed: [{ name: 'plugin', version: '1.0.0', bundleDependencies: [], peerDependencies: { 'fast-uri': '^4.0.0' } }],
    },
    /plugin@1\.0\.0/
  );
  expectRefused(
    {
      overrides: { 'fast-uri': '>=3.1.6 <4' },
      installed: [
        {
          name: 'plugin',
          version: '1.0.0',
          bundleDependencies: true as unknown as string[], // `true` bundles every dependency, not peers
          peerDependencies: { 'fast-uri': '^4.0.0' },
        },
      ],
    },
    /plugin@1\.0\.0/
  );
});

test('finds a scoped consumer', () => {
  expectRefused(
    {
      overrides: { 'fast-uri': '>=3.1.6 <4' },
      installed: [{ name: '@scope/consumer', version: '1.0.0', dependencies: { 'fast-uri': '^4.0.0' } }],
    },
    /@scope\/consumer@1\.0\.0/
  );
});

test('checks every installed version of a consumer, and names the one held below', () => {
  const problems = checkOverrideConsumers(
    repo({
      overrides: { 'fast-uri': '>=3.1.6 <4' },
      installed: [stringify('6.4.0', { 'fast-uri': '^3.0.0' }), stringify('7.0.1', { 'fast-uri': '^4.0.0' })],
    })
  ).map(p => p.message);
  assert.equal(problems.length, 1);
  assert.match(problems[0] ?? '', /fast-json-stringify@7\.0\.1/);
});

test('refuses a cap that admits the declared range in theory but installs below it', () => {
  // Every version the cap allows inside `^3.5.2` is unpublished, so pnpm installs 3.5.1.
  expectRefused(
    {
      overrides: { 'fast-uri': '>=3.1.6 <3.6' },
      installed: [{ ...stringify('7.0.1', { 'fast-uri': '^3.5.2' }), resolved: { 'fast-uri': '3.5.1' } }],
    },
    /installs fast-uri 3\.5\.1 for fast-json-stringify@7\.0\.1, below what it declares \(`\^3\.5\.2`\)/
  );
});

test('reads a peer suffix off the installed version', () => {
  expectRefused(
    {
      overrides: { 'fast-uri': '>=3.1.6 <3.6' },
      installed: [{ ...stringify('7.0.1', { 'fast-uri': '^3.5.2' }), resolved: { 'fast-uri': '3.5.1(ajv@8.20.0)' } }],
    },
    /installs fast-uri 3\.5\.1 for/
  );
});

test('reads what a workspace importer installed', () => {
  expectRefused(
    { overrides: { 'fast-uri': '>=3.1.6 <4.1' }, devDependencies: { 'fast-uri': '^4.0.0' }, rootResolved: { 'fast-uri': '3.9.0' } },
    /installs fast-uri 3\.9\.0 for root \(package\.json\)/
  );
});

test('accepts an install above the declared range: the upward unlock', () => {
  expectClean({
    overrides: { 'deepmerge-ts': '>=8.0.2' },
    installed: [
      { name: '@prisma/config', version: '7.10.0', dependencies: { 'deepmerge-ts': '7.1.5' }, resolved: { 'deepmerge-ts': '8.0.2' } },
    ],
  });
});

test('reports one problem once, however many fields declare it', () => {
  const problems = checkOverrideConsumers(
    repo({
      overrides: { 'fast-uri': '>=3.1.6 <4' },
      installed: [
        { name: 'dual', version: '1.0.0', dependencies: { 'fast-uri': '^4.0.0' }, optionalDependencies: { 'fast-uri': '^4.0.0' } },
      ],
    })
  );
  assert.equal(problems.length, 1);
});

test('skips registry-less specifiers by their shape', () => {
  expectClean({
    overrides: { 'fast-uri': '>=3.1.6 <4' },
    installed: [
      stringify('7.0.1', { 'fast-uri': 'jsr:@std/fast-uri@^4' }),
      stringify('7.0.2', { 'fast-uri': 'user/fast-uri#v4' }),
      stringify('7.0.3', { 'fast-uri': 'gitlab:user/fast-uri' }),
      stringify('7.0.4', { 'fast-uri': './vendor/fast-uri.tgz' }),
    ],
  });
});
