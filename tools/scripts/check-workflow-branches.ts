/**
 * Deterministic gate for the branch names duplicated across the workflow files.
 *
 * ## Why it exists
 *
 * The active release train is named in more than one place and GitHub gives us
 * no way to collapse them: `on.push.branches` and `on.pull_request.branches`
 * are filters evaluated before a run exists, so they cannot read `env`, `vars`
 * or any expression. The names therefore have to agree by hand — and CLAUDE.md
 * has carried a "update it in these places" checklist precisely because they
 * did not.
 *
 * Every failure in that class is silent. Switch the train and update ci.yml but
 * not `RELEASE_TRAIN_BRANCH`, and the weekly OSV job keeps scanning the old
 * branch, which still exists during the overlap, so nothing goes red while the
 * new train gets no post-disclosure coverage for a whole cycle. Miss
 * release.yml's copy instead and every RC tag is refused by the provenance
 * gate, at the moment someone is trying to ship a candidate.
 *
 * security.yml no longer duplicates the name at all — its `push` filter matches
 * `develop-*` and `release/*` by pattern, so there is nothing to keep in sync
 * and nothing to forget. This checker exists for the copies that cannot be
 * patterned away, and for the one property the pattern still has to satisfy.
 *
 * ## What it asserts
 *
 * - security.yml's `push` filter matches its own `RELEASE_TRAIN_BRANCH`. A
 *   pattern that stopped covering the train would be the same silent hole.
 * - release.yml and security.yml name the *same* train.
 * - ci.yml's `push` and `pull_request` filters both cover the train and the
 *   stable branch, so a cycle switch that forgets ci.yml goes red here instead
 *   of quietly disabling CI on the new branch's pull requests.
 *
 * ## Parsing
 *
 * Line-oriented, and deliberately strict: every value it needs must be found,
 * and a file it cannot read the way it expects is an error rather than a pass.
 * A YAML library would be better and is not available — `yaml` is in the store
 * as a transitive dependency of other packages, not a declared one here, and
 * adding a root dependency to run a checker is a platform change that belongs
 * to `/luke-deps`, not to this file.
 */

import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';

import { REPO_ROOT } from './lib/report';

/** A rejection. Distinct type so the tests assert on this checker. */
export class WorkflowBranchError extends Error {}

/**
 * GitHub's branch filter globbing, which is not shell globbing: `*` stops at a
 * `/`, `**` crosses it. `release/*` matching `release/2.2` but not
 * `release/2.2/hotfix` is the behaviour that matters here.
 */
export function matchesFilter(pattern: string, branch: string): boolean {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '*') {
      if (pattern[i + 1] === '*') {
        re += '.*';
        i++;
      } else {
        re += '[^/]*';
      }
    } else if ('\\^$.|?+()[]{}'.includes(ch)) {
      re += `\\${ch}`;
    } else {
      re += ch;
    }
  }
  return new RegExp(`^${re}$`).test(branch);
}

/** `branches: [a, 'b-*']` under the given trigger key, as a list. */
export function readBranchFilter(source: string, file: string, trigger: string): string[] {
  const lines = source.split('\n');
  const triggerAt = lines.findIndex(l => new RegExp(`^  ${trigger}:\\s*$`).test(l));
  if (triggerAt === -1) {
    throw new WorkflowBranchError(`${file}: no \`${trigger}:\` trigger found.`);
  }

  for (let i = triggerAt + 1; i < lines.length; i++) {
    const line = lines[i];
    // Left the trigger's block: a new top-level or trigger-level key.
    if (/^\S/.test(line) || /^\s{2}\S/.test(line)) break;

    const m = /^\s{4}branches:\s*\[(.*)\]\s*$/.exec(line);
    if (m !== null) {
      return m[1]
        .split(',')
        .map(v => v.trim().replace(/^['"]|['"]$/g, ''))
        .filter(v => v !== '');
    }
  }

  throw new WorkflowBranchError(
    `${file}: \`${trigger}\` has no inline \`branches: [...]\` list. This checker ` +
      'reads that exact form; if the file moved to a block list, teach it the new one ' +
      'rather than removing the check.'
  );
}

/** A `KEY: value` under the top-level `env:` block. */
export function readWorkflowEnv(source: string, file: string, key: string): string {
  const lines = source.split('\n');
  const envAt = lines.findIndex(l => /^env:\s*$/.test(l));
  if (envAt === -1) {
    throw new WorkflowBranchError(`${file}: no top-level \`env:\` block.`);
  }

  for (let i = envAt + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^\S/.test(line)) break;

    const m = new RegExp(`^\\s{2}${key}:\\s*(.+?)\\s*$`).exec(line);
    if (m !== null) return m[1].replace(/^['"]|['"]$/g, '');
  }

  throw new WorkflowBranchError(`${file}: \`env.${key}\` not found.`);
}

export interface Problem {
  file: string;
  message: string;
}

export function checkWorkflowBranches(root: string): Problem[] {
  const problems: Problem[] = [];
  const read = (name: string): string =>
    readFileSync(join(root, '.github/workflows', name), 'utf-8');

  const security = read('security.yml');
  const release = read('release.yml');
  const ci = read('ci.yml');

  const train = readWorkflowEnv(security, 'security.yml', 'RELEASE_TRAIN_BRANCH');
  const releaseTrain = readWorkflowEnv(release, 'release.yml', 'RELEASE_TRAIN_BRANCH');
  const stable = readWorkflowEnv(release, 'release.yml', 'STABLE_BRANCH');

  const securityPush = readBranchFilter(security, 'security.yml', 'push');
  if (!securityPush.some(p => matchesFilter(p, train))) {
    problems.push({
      file: '.github/workflows/security.yml',
      message:
        `push filter [${securityPush.join(', ')}] does not match ` +
        `RELEASE_TRAIN_BRANCH "${train}": the train would get no push scanning.`,
    });
  }

  if (releaseTrain !== train) {
    problems.push({
      file: '.github/workflows/release.yml',
      message:
        `RELEASE_TRAIN_BRANCH is "${releaseTrain}" but security.yml says "${train}". ` +
        'The provenance gate would refuse every RC tag cut from the real train.',
    });
  }

  for (const trigger of ['push', 'pull_request']) {
    const filter = readBranchFilter(ci, 'ci.yml', trigger);
    for (const branch of [train, stable]) {
      if (!filter.some(p => matchesFilter(p, branch))) {
        problems.push({
          file: '.github/workflows/ci.yml',
          message:
            `${trigger} filter [${filter.join(', ')}] does not cover "${branch}": ` +
            'CI would silently stop running on that branch.',
        });
      }
    }
  }

  return problems;
}

/**
 * The train must also be a branch that exists, otherwise the weekly job is
 * aimed at nothing. Advisory only — a fresh clone may not have fetched it, and
 * this checker runs in `check:drift` where a missing remote ref is not a
 * codebase defect.
 */
function trainBranchExists(root: string, branch: string): boolean {
  for (const ref of [`refs/remotes/origin/${branch}`, `refs/heads/${branch}`]) {
    try {
      execFileSync('git', ['rev-parse', '--verify', '--quiet', ref], {
        cwd: root,
        stdio: 'ignore',
      });
      return true;
    } catch {
      /* try the next ref */
    }
  }
  return false;
}

function main(): void {
  const problems = checkWorkflowBranches(REPO_ROOT);

  if (problems.length > 0) {
    throw new Error(
      `[workflow-branches] ${problems.length} problems:\n` +
        problems.map(p => `  ${p.file} — ${p.message}`).join('\n') +
        '\n\nBranch names duplicated across workflows drift silently: the old ' +
        'branch still exists during the overlap, so nothing goes red.'
    );
  }

  const security = readFileSync(
    join(REPO_ROOT, '.github/workflows/security.yml'),
    'utf-8'
  );
  const train = readWorkflowEnv(security, 'security.yml', 'RELEASE_TRAIN_BRANCH');
  const known = trainBranchExists(REPO_ROOT, train);

  console.log(
    `[workflow-branches] ok — release train "${train}" is covered by ` +
      "security.yml's push patterns, matches release.yml, and is inside ci.yml's " +
      'push and pull_request filters.' +
      (known ? '' : `\n  note: no local or origin ref for "${train}" in this clone.`)
  );
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(message);
    process.exit(1);
  }
}
