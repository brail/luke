/**
 * Behavioral proof for `check-image-runtime.ts`, on throwaway trees laid out
 * the way pnpm and Next lay out the real images.
 *
 * Each case breaks one promise and asserts the checker names it; the clean
 * cases assert it stays quiet on layouts that are correct but unusual (a peer, a
 * platform optional that is absent, a package found through pnpm's hoisting
 * directory), because a check that refuses a correct image gets switched off.
 * The probes that need a real image — native addons, the Prisma CLI, the web
 * server — are proved by the `images` CI job, not here.
 *
 * Run: `pnpm test:tools`
 */

import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { after, test } from 'node:test';

import {
  auditClosure,
  auditInventory,
  foreignEntries,
  listEntries,
  pngWidth,
  unresolvedRequires,
  webInventory,
  workspaceDirs,
} from './check-image-runtime';

const created: string[] = [];

after(() => {
  for (const dir of created) rmSync(dir, { recursive: true, force: true });
});

function tree(): string {
  const root = mkdtempSync(join(tmpdir(), 'image-runtime-'));
  created.push(root);
  write(root, 'pnpm-workspace.yaml', 'packages:\n  - apps/*\n');
  write(
    root,
    'package.json',
    JSON.stringify({ name: 'root', devDependencies: { tool: '1' } })
  );
  return root;
}

function write(root: string, path: string, content: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
}

/** A store package `name@version`, with the manifest groups given. */
function storePackage(
  root: string,
  name: string,
  manifest: object = {}
): string {
  const dir = join(
    root,
    'node_modules',
    '.pnpm',
    `${name}@1.0.0`,
    'node_modules',
    name
  );
  write(
    root,
    relative(root, join(dir, 'package.json')),
    JSON.stringify({ name, ...manifest })
  );
  return dir;
}

/** `from/node_modules/name` → `target`, relative, as pnpm writes it. */
function link(from: string, name: string, target: string): void {
  const at = join(from, 'node_modules', name);
  mkdirSync(dirname(at), { recursive: true });
  symlinkSync(relative(dirname(at), target), at);
}

/** One app depending on `x`, `x` depending on `y`: the minimal clean closure. */
function cleanClosure(): { root: string; app: string; x: string; y: string } {
  const root = tree();
  const app = join(root, 'apps', 'a');
  write(
    root,
    'apps/a/package.json',
    JSON.stringify({ name: 'a', dependencies: { x: '1' } })
  );
  const x = storePackage(root, 'x', { dependencies: { y: '1' } });
  const y = storePackage(root, 'y');
  link(app, 'x', x);
  link(join(x, '..', '..'), 'y', y);
  return { root, app, x, y };
}

test('a production closure has no orphan and nothing unresolved', () => {
  const { root } = cleanClosure();
  assert.deepEqual(auditClosure(root), {
    orphans: [],
    unresolved: [],
    storeEntries: 2,
  });
});

test('a store entry nothing reaches is an orphan — the full-tree image', () => {
  const { root } = cleanClosure();
  storePackage(root, 'tool');
  assert.deepEqual(auditClosure(root).orphans, ['tool@1.0.0']);
});

test("a workspace manifest's devDependencies are not edges", () => {
  const { root, app } = cleanClosure();
  write(
    root,
    'apps/a/package.json',
    JSON.stringify({
      name: 'a',
      dependencies: { x: '1' },
      devDependencies: { tool: '1' },
    })
  );
  link(app, 'tool', storePackage(root, 'tool'));
  assert.deepEqual(auditClosure(root).orphans, ['tool@1.0.0']);
});

test('a dependencies entry that does not resolve is reported', () => {
  const { root } = cleanClosure();
  write(
    root,
    'apps/a/package.json',
    JSON.stringify({ name: 'a', dependencies: { x: '1', lost: '1' } })
  );
  assert.deepEqual(auditClosure(root).unresolved, ['apps/a → lost']);
});

test('an optional entry overrides dependencies, and an absent platform optional is fine', () => {
  const root = tree();
  const app = join(root, 'apps', 'a');
  write(
    root,
    'apps/a/package.json',
    JSON.stringify({ name: 'a', dependencies: { x: '1' } })
  );
  const x = storePackage(root, 'x', {
    dependencies: { both: '1' },
    optionalDependencies: { both: '1', 'plat-other': '1', 'plat-here': '1' },
  });
  const here = storePackage(root, 'plat-here');
  link(app, 'x', x);
  link(join(x, '..', '..'), 'plat-here', here);
  assert.deepEqual(auditClosure(root), {
    orphans: [],
    unresolved: [],
    storeEntries: 2,
  });
});

test('an installed peer is reached; an absent one is not an error', () => {
  const { root, x } = cleanClosure();
  write(
    root,
    relative(root, join(x, 'package.json')),
    JSON.stringify({
      name: 'x',
      dependencies: { y: '1' },
      peerDependencies: { p: '1', absent: '1' },
    })
  );
  link(join(x, '..', '..'), 'p', storePackage(root, 'p'));
  assert.deepEqual(auditClosure(root), {
    orphans: [],
    unresolved: [],
    storeEntries: 3,
  });
});

test("a package found through pnpm's hoisting directory is reached; its metadata is not an entry", () => {
  const { root, x } = cleanClosure();
  write(
    root,
    relative(root, join(x, 'package.json')),
    JSON.stringify({ name: 'x', dependencies: { y: '1', h: '1' } })
  );
  const h = storePackage(root, 'h');
  link(join(root, 'node_modules', '.pnpm'), 'h', h);
  write(root, 'node_modules/.pnpm/lock.yaml', 'lockfileVersion: 9\n');
  assert.deepEqual(auditClosure(root), {
    orphans: [],
    unresolved: [],
    storeEntries: 3,
  });
});

test('a workspace package reached through a link is walked once', () => {
  const { root, app } = cleanClosure();
  const lib = join(root, 'apps', 'lib');
  write(
    root,
    'apps/lib/package.json',
    JSON.stringify({ name: 'lib', dependencies: { y: '1' } })
  );
  link(
    lib,
    'y',
    join(root, 'node_modules', '.pnpm', 'y@1.0.0', 'node_modules', 'y')
  );
  write(
    root,
    'apps/a/package.json',
    JSON.stringify({ name: 'a', dependencies: { x: '1', lib: 'workspace:*' } })
  );
  link(app, 'lib', lib);
  assert.deepEqual(auditClosure(root), {
    orphans: [],
    unresolved: [],
    storeEntries: 2,
  });
});

/** A built web app: standalone (with a pnpm link), static assets, public. */
function builtWeb(): string {
  const repo = tree();
  write(repo, 'apps/web/.next/standalone/apps/web/server.js', '');
  write(
    repo,
    'apps/web/.next/standalone/node_modules/.pnpm/next@1.0.0/node_modules/next/index.js',
    ''
  );
  link(
    join(repo, 'apps/web/.next/standalone/apps/web'),
    'next',
    join(
      repo,
      'apps/web/.next/standalone/node_modules/.pnpm/next@1.0.0/node_modules/next'
    )
  );
  write(repo, 'apps/web/.next/static/chunks/a.js', '');
  write(repo, 'apps/web/public/author.png', '');
  return repo;
}

/** The runner as the Dockerfile lays it out from `builtWeb`. */
function runner(): string {
  const image = mkdtempSync(join(tmpdir(), 'image-web-'));
  created.push(image);
  write(image, 'apps/web/server.js', '');
  write(image, 'node_modules/.pnpm/next@1.0.0/node_modules/next/index.js', '');
  link(
    join(image, 'apps/web'),
    'next',
    join(image, 'node_modules/.pnpm/next@1.0.0/node_modules/next')
  );
  write(image, 'apps/web/.next/static/chunks/a.js', '');
  write(image, 'apps/web/public/author.png', '');
  return image;
}

test('the web inventory lists files and links at their runtime paths', () => {
  assert.deepEqual(webInventory(builtWeb()), [
    'f apps/web/.next/static/chunks/a.js',
    'f apps/web/public/author.png',
    'f apps/web/server.js',
    'f node_modules/.pnpm/next@1.0.0/node_modules/next/index.js',
    'l apps/web/node_modules/next',
  ]);
});

test('a runner laid out from the inventory passes', () => {
  const repo = builtWeb();
  const inventory = webInventory(repo).join('\n');
  assert.deepEqual(auditInventory(runner(), inventory), {
    extra: [],
    missing: [],
  });
});

test('anything the inventory does not name is extra — a full node_modules copy', () => {
  const repo = builtWeb();
  const image = runner();
  write(
    image,
    'node_modules/.pnpm/typescript@6.0.0/node_modules/typescript/index.js',
    ''
  );
  assert.deepEqual(auditInventory(image, webInventory(repo).join('\n')).extra, [
    'f node_modules/.pnpm/typescript@6.0.0/node_modules/typescript/index.js',
  ]);
});

test('an entitled entry the runner lacks is missing; a link is not a file', () => {
  const repo = builtWeb();
  const image = runner();
  rmSync(join(image, 'apps/web/public'), { recursive: true });
  unlinkSync(join(image, 'apps/web/node_modules/next'));
  write(image, 'apps/web/node_modules/next', '');
  const { extra, missing } = auditInventory(
    image,
    webInventory(repo).join('\n')
  );
  assert.deepEqual(missing, [
    'f apps/web/public/author.png',
    'l apps/web/node_modules/next',
  ]);
  assert.deepEqual(extra, ['f apps/web/node_modules/next']);
});

test('listEntries never follows a link', () => {
  const repo = builtWeb();
  const lines = listEntries(join(repo, 'apps/web/.next/standalone'));
  assert.ok(
    !lines.some(line => line.startsWith('f apps/web/node_modules/next/'))
  );
});

test('pngWidth reads IHDR and refuses what is not a PNG', () => {
  const header = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header);
  header.writeUInt32BE(64, 16);
  assert.equal(pngWidth(header), 64);
  assert.equal(pngWidth(Buffer.from('GIF89a-not-a-png-at-all!')), null);
});

test('an exclusion glob is refused rather than read as a path', () => {
  const root = tree();
  write(
    root,
    'pnpm-workspace.yaml',
    "packages:\n  - apps/*\n  - '!apps/legacy'\n"
  );
  assert.throws(() => workspaceDirs(root), /Unsupported workspace exclusion/);
});

test('a compiled require the manifests forgot is reported; builtins and relatives are not', () => {
  const { root } = cleanClosure();
  write(
    root,
    'apps/a/dist/index.js',
    [
      'const x = require("x");',
      'const fs = require("fs");',
      'const path = require("node:path");',
      'const local = require("./local");',
      'const ghost = require("ghost/sub/path");',
      'const scoped = require("@scope/gone/deep");',
    ].join('\n')
  );
  assert.deepEqual(unresolvedRequires(root), [
    'apps/a/dist/index.js → @scope/gone',
    'apps/a/dist/index.js → ghost',
  ]);
});

test('the web image holds nothing outside apps/web and node_modules', () => {
  assert.deepEqual(
    foreignEntries([
      'f apps/web/server.js',
      'l node_modules/.pnpm/next@1.0.0/node_modules/next',
      'f apps/api/dist/index.js',
      'f packages/core/dist/index.js',
    ]),
    ['f apps/api/dist/index.js', 'f packages/core/dist/index.js']
  );
});
