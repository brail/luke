/**
 * `isolateGitEnv` (preloaded by `pnpm test:tools`) keeps a fixture's git commands inside the
 * fixture when the test process inherits a repository from its parent. git exports `GIT_DIR` to
 * hooks, and a fixture's `git init` / `git config` run from the pre-push hook of a worktree push
 * wrote into the real repository (#161).
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { pathToFileURL } from 'node:url';

import { REPO_ROOT } from './report';
// Also imported here, so this file's own setup stays inside its temp directories when run without
// the `test:tools` preload.
import './isolateGitEnv';

const created: string[] = [];
after(() => {
  for (const dir of created) rmSync(dir, { recursive: true, force: true });
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  created.push(dir);
  return dir;
}

// What the fixtures do: their own repository in a temp directory, a fixture identity, a commit.
const FIXTURE = `
const { execFileSync } = require('node:child_process');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const dir = mkdtempSync(join(tmpdir(), 'luke-isolate-fixture-'));
const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
git('init', '-q');
git('config', 'user.name', 'fixture');
git('config', 'user.email', 'fixture@example.invalid');
git('config', 'commit.gpgsign', 'false');
git('commit', '-q', '--allow-empty', '-m', 'fixture');
process.stdout.write(dir);
`;

function snapshot(gitDir: string): { config: string; head: string; refs: string } {
  return {
    config: readFileSync(join(gitDir, 'config'), 'utf8'),
    head: readFileSync(join(gitDir, 'HEAD'), 'utf8'),
    refs: execFileSync('git', ['--git-dir', gitDir, 'for-each-ref'], { encoding: 'utf8' }),
  };
}

test('a fixture run with GIT_DIR naming another repository leaves that repository untouched', () => {
  const outer = tempDir('luke-isolate-outer-');
  execFileSync('git', ['init', '-q', outer]);
  const outerGitDir = join(outer, '.git');
  const before = snapshot(outerGitDir);

  const fixtureDir = execFileSync(
    process.execPath,
    ['--import', 'tsx', '--import', pathToFileURL(join(__dirname, 'isolateGitEnv.ts')).href, '-e', FIXTURE],
    { encoding: 'utf8', env: { ...process.env, GIT_DIR: outerGitDir } }
  );
  created.push(fixtureDir);

  assert.deepEqual(snapshot(outerGitDir), before);
  // The commit landed in the fixture's own repository (throws if HEAD does not resolve there).
  execFileSync('git', ['-C', fixtureDir, 'rev-parse', '--verify', '-q', 'HEAD'], { stdio: 'ignore' });
});

test('test:tools preloads isolateGitEnv before running the suites', () => {
  const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  };
  const script = pkg.scripts['test:tools'];
  const preload = script.indexOf('--import ./tools/scripts/lib/isolateGitEnv.ts');
  assert.ok(preload !== -1, `test:tools does not preload isolateGitEnv: ${script}`);
  assert.ok(preload < script.indexOf('--test'), `the preload must come before --test: ${script}`);
});
