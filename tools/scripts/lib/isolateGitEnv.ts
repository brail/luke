/**
 * Preloaded by `pnpm test:tools` (`node --import`): removes from this process's environment every
 * variable that tells git which repository to use. The tests' git commands — fixture spawns, the
 * checkers they run as child processes, in-process calls — then act on the fixtures' own
 * directories. git exports `GIT_DIR` to hooks, and the pre-push hook of a push made from a worktree
 * runs these tests: without this, a fixture's `git init` and `git config` wrote into the real
 * repository (#161). The list is git's own, not a copy.
 */

import { execFileSync } from 'node:child_process';

for (const name of execFileSync('git', ['rev-parse', '--local-env-vars'], { encoding: 'utf8' }).split('\n')) {
  // nosemgrep: luke-no-direct-env -- removes git's repository-locating variables from the test process; nothing is read
  if (name) Reflect.deleteProperty(process.env, name);
}
