/**
 * Deterministic gate for the shape of the workflows that decide when CI runs
 * and what a merge on `main` will be allowed to depend on.
 *
 * `ci.yml` skips a push confined to documentation through a `paths-ignore`
 * allowlist under its `push` trigger, and `docs.yml` runs the drift check on
 * those pushes instead. GitHub evaluates the YAML and nothing else, so every
 * safety property is a property of the two files' shape, and a shape nobody
 * checks drifts in the silent direction: add `'**.md'` and every future
 * Markdown file anywhere becomes documentation; add a filter under
 * `pull_request` and the required checks on `main` sit Pending on every
 * documentation PR; let the Docs job lose its `pnpm check:drift` step, or
 * keep the step behind a `continue-on-error:`, and a documentation push is
 * observed by a job that reports success without having checked anything.
 *
 * Asserted here, each with a red fixture in the test file:
 * - `ci.yml` `push.paths-ignore` is exactly the allowlist below as a
 *   duplicate-free set (no negations, so order is irrelevant); no
 *   `push.paths`; no filter of either kind under `pull_request`;
 *   `workflow_call` kept.
 * - `security.yml` and `release.yml` carry no path filter at all.
 * - `docs.yml` declares exactly the trigger set `{ push }`, with exactly the
 *   broad path set below and branches covering `main` and the release train,
 *   and declares exactly one job — `Documentation drift` — carrying a
 *   checkout step, a `./.github/actions/setup-workspace` step, and a step
 *   whose `run:` is exactly `pnpm check:drift` written inline on one line;
 *   and carrying no `if:` and no `continue-on-error:` at any level. Step
 *   order is not asserted: steps in the wrong order fail visibly on the
 *   runner, which is not the silent-success state this gate exists for.
 * - Every tracked file CI ignores triggers docs.yml, and every ignore pattern
 *   matches a tracked file.
 * - `ci.yml` declares an aggregate job named `CI gate`: `needs` exactly its
 *   other jobs, `if: ${{ always() }}`, no other `if:` and no
 *   `continue-on-error:` at any level, no `uses:` at all, and one single step
 *   whose `run:` is the pinned one-line script that treats the literal
 *   `success` as the only acceptable dependency result, run by an explicitly
 *   pinned `shell: bash`. That name is the stable candidate the ruleset on
 *   `main` will require in place of the individual job names — a separate
 *   remote change, deliberately deferred until a real train PR has produced
 *   the context. The list it will stand for must therefore be ci.yml's own,
 *   compared against the file's jobs rather than a constant here, which makes
 *   a newly added job a missing `needs` entry instead of a silently unguarded
 *   one. The current remote context list is deliberately not encoded here:
 *   this checker owns the repository's half of the contract and nothing else.
 *   The two invariants are coupled, which is why they live together: the gate
 *   will only be sound as a required check because ci.yml's `pull_request`
 *   carries no path filter, asserted just above it.
 *
 * Line-oriented and strict, like `check-workflow-branches.ts`: it reads the
 * shapes these workflows actually use and treats anything else as an error,
 * never a pass. Its glob is separate from the branch checker's because GitHub
 * lets `**\/` match zero directories in a path filter (`docs/**\/*.md` matches
 * `docs/README.md`), which a branch filter never needs.
 */

import { execFileSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

import { matchesFilter, readBranchFilter, readWorkflowEnv } from './check-workflow-branches';
import { formatProblems, REPO_ROOT, type Problem } from './lib/report';

/** A workflow this checker cannot read the way it expects. Never a pass. */
export class WorkflowPathError extends Error {}

/**
 * The documentation ownership surface: locations whose content no build,
 * lint, typecheck, test, image or release step reads. Deliberately absent:
 * `CHANGELOG.md` (release control), `.github/**`, test fixtures, Markdown
 * inside a source tree, non-Markdown files under `docs/` or `.claude/skills/`.
 * GitHub consumes the YAML copy; this copy plus the set-equality check below
 * is the only binding available for a filter evaluated before any run exists.
 */
export const CI_DOCUMENTATION_PATHS_IGNORE = [
  'docs/**/*.md',
  'docs/**/*.pdf',
  'README.md',
  'CLAUDE.md',
  'lessons.md',
  'lessons-archive.md',
  'API_SETUP.md',
  'APP_CONFIG.md',
  'OPERATIONS.md',
  'SETUP_STATUS.md',
  'INTEGRATIONS_ROADMAP.md',
  'apps/*/README.md',
  'packages/*/README.md',
  'tools/README.md',
  '.claude/skills/**/*.md',
] as const;

/**
 * The aggregate gate's name, and the candidate context for `main`'s ruleset.
 * Branch protection names its contexts as strings: it cannot follow a rename
 * and never learns about a new job, so one name that carries the dependency on
 * everything else is meant to replace a list nobody can keep in step. The
 * ruleset still names the individual jobs today; swapping it for this one is a
 * separate remote change, deferred until a real train PR has produced this
 * context. Deliberately not paired with a pinned list of job names here
 * — neither ci.yml's, which is read from the file, nor the ruleset's, which is
 * not this checker's to know.
 */
export const CI_GATE_NAME = 'CI gate';

/**
 * Job-level condition. A gate without it is skipped in exactly the runs it
 * exists to fail — GitHub skips a job whose dependency failed, was cancelled
 * or was skipped — and a skipped check reports neutral, not failed, which is
 * worth nothing to a ruleset that requires it.
 */
export const CI_GATE_IF = '${{ always() }}';

/**
 * The interpreter the pinned script's semantics belong to, declared on the
 * step rather than inherited from the runner default — which is not part of
 * any contract and would change under the job without a diff here. What runs
 * the line decides whether it asserts anything at all: `shell: echo {0}` would
 * print the script and exit 0, a green gate that never looked at a result.
 * One declaration exactly, so a second one cannot quietly win.
 */
export const CI_GATE_SHELL = 'bash';

/** The gate's only input, bound to `RESULTS`: every dependency's result, space separated. */
export const CI_GATE_RESULTS = "${{ join(needs.*.result, ' ') }}";

/**
 * The gate's whole body, pinned as a literal because it *is* the semantics:
 * it accepts the exact string `success` and rejects everything else, so
 * `failure`, `cancelled`, `skipped` and any result GitHub adds later fail
 * closed. It counts its arguments before looping because that is not
 * redundant: a `needs` that resolved to nothing, or to whitespace, would
 * otherwise iterate zero times and pass. The test suite executes this exact
 * string against each of those results rather than only comparing it.
 */
export const CI_GATE_RUN =
  'echo "results=$RESULTS"; set -- $RESULTS; [ $# -gt 0 ] || exit 1; for r in "$@"; do [ "$r" = success ] || exit 1; done';

/** The deliberately broader trigger of docs.yml: a superset of the list above. */
export const DOCS_TRIGGER_PATHS = ['docs/**', '**.md'] as const;

/**
 * The complete trigger set of docs.yml, compared as a set rather than against
 * a denylist so that anything new is a decision taken here first.
 *
 * This workflow exists for exactly one reason: to observe the pushes ci.yml's
 * `push.paths-ignore` optimisation skips. That is a property of `push`
 * events, and the `paths` filter that expresses it is nested under `push` —
 * no other event inherits it. Pull requests and the merge queue are already
 * verified by ci.yml, which stays unfiltered, so `pull_request`,
 * `pull_request_target` and `merge_group` would add a second unfiltered run
 * of a gate that already reports there; `schedule` and `workflow_dispatch`
 * answer no contract this repository has. Widening the set is therefore a
 * deliberate edit to this constant and to the workflow together.
 */
export const DOCS_TRIGGERS = ['push'] as const;

/** The one job docs.yml declares, and the steps without which it checks nothing. */
export const DOCS_JOB_NAME = 'Documentation drift';
const DOCS_JOB_CHECKOUT = /^actions\/checkout@/;
const DOCS_JOB_SETUP = './.github/actions/setup-workspace';
const DOCS_JOB_RUN = 'pnpm check:drift';

/**
 * The keys that let a job report success without having done its work, at job
 * level (4 spaces) or step level (6 with the dash, 8 without), with the value
 * so a caller can allow one exact spelling. For the Docs job their *absence*
 * is the contract, so `if: true` and `continue-on-error: false` are rejected
 * with the rest: reading the expression is a YAML evaluator's job, and a gate
 * that tried would be arguing about `success()` instead of refusing the whole
 * class. Conditional behaviour there has to start as a change to this checker.
 * The CI gate is the one job that must carry exactly one of them.
 */
const JOB_CONTROL = /^( {4,8})(- )?(if|continue-on-error):\s*(.*?)\s*$/;

const PATH_FILTER_KEY = /^\s+paths(-ignore)?:/;

/**
 * GitHub's path filter globbing: `*` matches anything but `/`, `**` matches
 * anything including `/`, and `**` followed by `/` may match zero directories
 * (the documented examples give `docs/README.md` for `docs/**\/*.md` and the
 * root `README.md` for `**\/README.md`). Everything else is literal.
 */
export function matchesPathFilter(pattern: string, path: string): boolean {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '*') {
      if (pattern[i + 1] === '*') {
        i++;
        if (pattern[i + 1] === '/') {
          i++;
          re += '(?:.*/)?';
        } else {
          re += '.*';
        }
      } else {
        re += '[^/]*';
      }
    } else if ('\\^$.|?+()[]{}'.includes(ch)) {
      re += `\\${ch}`;
    } else {
      re += ch;
    }
  }
  return new RegExp(`^${re}$`).test(path);
}

// ── Line-oriented reading of the shapes these workflows use ──────────────────

interface Workflow {
  file: string;
  text: string;
  lines: string[];
}

/** A header line and the index just past its body (the next key at or above `indent`). */
interface Section {
  start: number;
  end: number;
}

function unquote(value: string): string {
  return value.trim().replace(/^['"]|['"]$/g, '');
}

function load(root: string, name: string): Workflow | null {
  const path = join(root, '.github/workflows', name);
  if (!existsSync(path)) return null;
  const text = readFileSync(path, 'utf-8');
  return { file: `.github/workflows/${name}`, text, lines: text.split('\n') };
}

function section(lines: string[], header: RegExp, indent: number, from = 0, to = lines.length): Section | null {
  let start = -1;
  for (let i = from; i < to; i++) {
    if (header.test(lines[i])) {
      start = i;
      break;
    }
  }
  if (start === -1) return null;
  const closes = new RegExp(`^\\s{0,${indent}}\\S`);
  let end = start + 1;
  while (end < to && !closes.test(lines[end])) end++;
  return { start, end };
}

function topLevel(wf: Workflow, key: string): Section {
  const found = section(wf.lines, new RegExp(`^${key}:\\s*$`), 0);
  if (found === null) throw new WorkflowPathError(`${wf.file}: no top-level \`${key}:\` block.`);
  return found;
}

/** `on.<name>`. A bodiless trigger such as `workflow_call:` is present with an empty body. */
function trigger(wf: Workflow, name: string): Section | null {
  const on = topLevel(wf, 'on');
  return section(wf.lines, new RegExp(`^ {2}${name}:\\s*$`), 2, on.start + 1, on.end);
}

/** Every trigger declared under the top-level `on:` block, in file order. */
function triggers(wf: Workflow): string[] {
  const on = topLevel(wf, 'on');
  const out: string[] = [];
  for (let i = on.start + 1; i < on.end; i++) {
    const m = /^ {2}([A-Za-z_]+):/.exec(wf.lines[i]);
    if (m !== null) out.push(m[1]);
  }
  return out;
}

interface Filter {
  entries: string[];
  line: number;
}

/**
 * The list a key introduces — inline `[a, b]` or block `- a` items, both at
 * the one indent every list in these files uses. A form it cannot read is an
 * error rather than an empty list: silence would report a filter as absent, or
 * a `needs` graph as unguarded.
 */
function readList(wf: Workflow, key: Section, label: string): Filter {
  const line = key.start + 1;
  const header = wf.lines[key.start];
  const rest = header.slice(header.indexOf(':') + 1).trim();
  if (rest === '') {
    return {
      line,
      entries: wf.lines
        .slice(key.start + 1, key.end)
        .filter(l => /^ {6}- /.test(l))
        .map(l => unquote(l.replace(/^ {6}- /, ''))),
    };
  }
  const inline = /^\[(.*)\]$/.exec(rest);
  if (inline === null) {
    throw new WorkflowPathError(`${wf.file}:${line}: \`${label}\` is neither an inline \`[...]\` list nor a block list.`);
  }
  return { line, entries: inline[1].split(',').map(unquote).filter(Boolean) };
}

/**
 * `on.<trigger>.<key>`, or null when the trigger or the key is absent. A key
 * that lists nothing is an error: an empty filter is not a narrower filter.
 */
function pathFilter(wf: Workflow, trig: string, key: 'paths' | 'paths-ignore'): Filter | null {
  const t = trigger(wf, trig);
  if (t === null) return null;
  const k = section(wf.lines, new RegExp(`^ {4}${key}:`), 4, t.start + 1, t.end);
  if (k === null) return null;

  const filter = readList(wf, k, `${trig}.${key}`);
  if (filter.entries.length === 0) {
    throw new WorkflowPathError(`${wf.file}:${filter.line}: \`${trig}.${key}\` lists nothing; an empty filter is not a narrower filter.`);
  }
  return filter;
}

interface Job {
  /** The key under `jobs:`, which is what a `needs:` list names. */
  id: string;
  name: string | null;
  uses: string[];
  run: string[];
  /** null when the job declares no `needs:` at all. */
  needs: Filter | null;
  /** The job's lines, for the one binding only the gate cares about. */
  body: string[];
  /** Every `shell:` the job declares, at any level: more than one is ambiguity. */
  shells: Array<{ value: string; level: 'job' | 'step'; line: number }>;
  /** Occurrences of `if:` / `continue-on-error:` anywhere in the job. */
  controls: Array<{ key: string; value: string; level: 'job' | 'step'; line: number }>;
  line: number;
}

/** Every job under `jobs:` with its name and the `uses`/`run` of its steps. */
function jobs(wf: Workflow): Job[] {
  const block = topLevel(wf, 'jobs');
  const out: Job[] = [];
  const isJob = /^ {2}([\w-]+):\s*$/;
  for (let i = block.start + 1; i < block.end; i++) {
    const header = isJob.exec(wf.lines[i]);
    if (header === null) continue;
    const job = section(wf.lines, isJob, 2, i, block.end);
    if (job === null) break;
    const body = wf.lines.slice(job.start + 1, job.end);
    const lineOf = (index: number): number => job.start + 2 + index;
    const values = (re: RegExp): string[] =>
      body.flatMap(l => {
        const m = re.exec(l);
        return m === null ? [] : [unquote(m[1])];
      });
    const needs = section(wf.lines, /^ {4}needs:/, 4, job.start + 1, job.end);
    out.push({
      body,
      line: job.start + 1,
      id: header[1],
      name: values(/^ {4}name:\s*(.+?)\s*$/)[0] ?? null,
      uses: values(/^ {6,8}(?:- )?uses:\s*(.+?)\s*$/),
      run: values(/^ {6,8}(?:- )?run:\s*(.+?)\s*$/),
      needs: needs === null ? null : readList(wf, needs, `${header[1]}.needs`),
      shells: body.flatMap((l, k) => {
        const m = /^( {4,10})(- )?shell:\s*(.*?)\s*$/.exec(l);
        if (m === null) return [];
        const level: 'job' | 'step' = m[1].length === 4 && m[2] === undefined ? 'job' : 'step';
        return [{ value: unquote(m[3]), level, line: lineOf(k) }];
      }),
      controls: body.flatMap((l, k) => {
        const m = JOB_CONTROL.exec(l);
        if (m === null) return [];
        const level: 'job' | 'step' = m[1].length === 4 && m[2] === undefined ? 'job' : 'step';
        return [{ key: m[3], value: unquote(m[4]), level, line: lineOf(k) }];
      }),
    });
    i = job.end - 1;
  }
  return out;
}

function trackedFiles(root: string): string[] {
  return execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
}

/**
 * Two lists as duplicate-free sets; each side's surplus is a problem of its
 * own. `surplus` completes "contains `x`, which …": the default is right for a
 * set pinned in this file, and a caller comparing against something the
 * repository itself declares passes its own.
 */
function compareAsSets(
  wf: Workflow,
  filter: Filter,
  label: string,
  expected: readonly string[],
  problems: Problem[],
  surplus = 'is not part of the pinned contract; widen the checker first, then the workflow'
): void {
  const seen = new Set<string>();
  for (const entry of filter.entries) {
    if (seen.has(entry)) problems.push({ file: wf.file, line: filter.line, message: `${label} lists \`${entry}\` twice.` });
    seen.add(entry);
  }
  for (const entry of expected) {
    if (!seen.has(entry)) problems.push({ file: wf.file, line: filter.line, message: `${label} is missing \`${entry}\`.` });
  }
  for (const entry of seen) {
    if (!expected.includes(entry)) {
      problems.push({
        file: wf.file,
        line: filter.line,
        message: `${label} contains \`${entry}\`, which ${surplus}.`,
      });
    }
  }
}

/**
 * @param tracked - The repository's tracked paths; defaults to `git ls-files`.
 *   Injectable so the fixture suite needs no git repository per case. An
 *   empty list makes every ignore pattern dead, which is the zero-discovery
 *   failure this gate wants: red, never a silent pass.
 */
export function checkWorkflowPaths(root: string, tracked: readonly string[] = trackedFiles(root)): Problem[] {
  const problems: Problem[] = [];
  const at = (wf: Workflow, line: number, message: string): void => {
    problems.push({ file: wf.file, line, message });
  };

  const ci = load(root, 'ci.yml');
  const security = load(root, 'security.yml');
  const release = load(root, 'release.yml');
  if (ci === null || security === null || release === null) {
    throw new WorkflowPathError('ci.yml, security.yml and release.yml must all exist under .github/workflows.');
  }

  // ── ci.yml: the allowlist, and nothing but the allowlist ──────────────────
  if (trigger(ci, 'workflow_call') === null) {
    at(ci, topLevel(ci, 'on').start + 1, '`on.workflow_call` is gone; release.yml reuses this workflow as its verify gate.');
  }

  const ignore = pathFilter(ci, 'push', 'paths-ignore');
  if (ignore === null) {
    at(ci, topLevel(ci, 'on').start + 1, '`push` has no `paths-ignore`; the documentation allowlist is the contract this checker pins.');
  } else {
    compareAsSets(ci, ignore, '`push.paths-ignore`', CI_DOCUMENTATION_PATHS_IGNORE, problems);
  }

  for (const [trig, key] of [
    ['push', 'paths'],
    ['pull_request', 'paths'],
    ['pull_request', 'paths-ignore'],
  ] as const) {
    const filter = pathFilter(ci, trig, key);
    if (filter !== null) {
      at(
        ci,
        filter.line,
        `\`${trig}.${key}\` is declared; ci.yml's only path filter is \`push.paths-ignore\`. ` +
          'A filtered pull_request leaves the required checks on main Pending.'
      );
    }
  }

  // ── ci.yml: the aggregate gate the ruleset will require ───────────────────
  const ciJobs = jobs(ci);
  const gate = ciJobs.find(j => j.name === CI_GATE_NAME);
  if (gate === undefined) {
    at(
      ci,
      topLevel(ci, 'jobs').start + 1,
      `no job is named \`${CI_GATE_NAME}\`; that is the candidate context the ruleset on \`main\` is meant to require, ` +
        'and without it there is nothing to switch to — every job stays named one by one in the ruleset, or guarded by nobody.'
    );
  } else {
    compareAsSets(
      ci,
      gate.needs ?? { entries: [], line: gate.line },
      `\`${CI_GATE_NAME}\`'s \`needs\``,
      ciJobs.filter(j => j !== gate).map(j => j.id),
      problems,
      "is not a job in ci.yml; the gate needs ci.yml's other jobs and nothing else"
    );

    const jobIf = gate.controls.find(c => c.level === 'job' && c.key === 'if');
    if (jobIf === undefined) {
      at(
        ci,
        gate.line,
        `job declares no \`if:\`; without \`if: ${CI_GATE_IF}\` it is skipped in exactly the runs it exists to fail, ` +
          'and a skipped check blocks no merge once the ruleset requires it.'
      );
    } else if (jobIf.value !== CI_GATE_IF) {
      at(ci, jobIf.line, `job declares \`if: ${jobIf.value}\`, not \`if: ${CI_GATE_IF}\`; anything else lets a failed dependency skip the gate.`);
    }
    for (const control of gate.controls) {
      if (control !== jobIf) {
        at(
          ci,
          control.line,
          `job declares \`${control.key}:\` besides its job-level \`if: ${CI_GATE_IF}\`; ` +
            'a second condition or a `continue-on-error:` reports the gate green while a dependency did not succeed.'
        );
      }
    }

    if (gate.uses.length > 0) {
      at(ci, gate.line, `job runs \`${gate.uses[0]}\`; the gate reads its dependencies' results and nothing else — no checkout, workspace setup, install or build.`);
    }
    if (gate.run.length !== 1 || gate.run[0] !== CI_GATE_RUN) {
      at(
        ci,
        gate.line,
        `job's steps are not exactly one \`run:\` equal to \`${CI_GATE_RUN}\`; ` +
          'that literal is the gate\'s semantics, read here in its inline one-line form and executed by the test suite.'
      );
    }
    // What interprets the pinned script. Counted across the whole job, so a
    // job-level `defaults.run.shell` added beside the step's own is ambiguity
    // rather than a silent winner.
    if (gate.shells.length === 0) {
      at(
        ci,
        gate.line,
        `job declares no \`shell:\`; the pinned script's semantics are \`${CI_GATE_SHELL}\`'s, and the runner default is not part of any contract.`
      );
    } else if (gate.shells.length > 1) {
      at(
        ci,
        gate.shells[1].line,
        `job declares ${gate.shells.length} \`shell:\` keys; exactly one decides what runs the pinned script, and two leave which one to GitHub's precedence rules.`
      );
    } else if (gate.shells[0].value !== CI_GATE_SHELL) {
      at(
        ci,
        gate.shells[0].line,
        `job declares \`shell: ${gate.shells[0].value}\`, not \`shell: ${CI_GATE_SHELL}\`; ` +
          'another interpreter need not fail on what the script rejects, and one like `echo {0}` would report success without executing it at all.'
      );
    } else if (gate.shells[0].level !== 'step') {
      at(ci, gate.shells[0].line, `job declares \`shell: ${CI_GATE_SHELL}\` at job level; it belongs on the step that carries the script.`);
    }

    // The one step's `env:`, at its own indent. Read here rather than through
    // a general `env` field on every job: at this indent a job with `services:`
    // also has its container's variables, and the gate has neither.
    const results = gate.body.flatMap((l, k) => {
      const m = /^ {10}RESULTS:\s*(.+?)\s*$/.exec(l);
      return m === null ? [] : [{ value: unquote(m[1]), line: gate.line + 1 + k }];
    })[0];
    if (results === undefined) {
      at(ci, gate.line, "job binds no `RESULTS`; the script would then read an empty variable rather than its dependencies' results.");
    } else if (results.value !== CI_GATE_RESULTS) {
      at(ci, results.line, `job binds \`RESULTS: ${results.value}\`, not \`${CI_GATE_RESULTS}\`; a value that is not the dependency results makes the gate assert nothing.`);
    }
  }

  // ── security.yml and release.yml: path-blind ──────────────────────────────
  for (const wf of [security, release]) {
    const hit = wf.lines.findIndex(l => PATH_FILTER_KEY.test(l));
    if (hit !== -1) at(wf, hit + 1, 'declares a path filter; security scans every push and the release gate is never path-aware.');
  }

  // ── docs.yml: the observer of the pushes ci.yml skips ─────────────────────
  const docs = load(root, 'docs.yml');
  if (docs === null) {
    problems.push({
      file: '.github/workflows/docs.yml',
      line: 1,
      message: 'does not exist; it observes the pushes ci.yml skips, so a documentation push would run nothing.',
    });
  } else {
    compareAsSets(docs, { entries: triggers(docs), line: topLevel(docs, 'on').start + 1 }, '`on`', DOCS_TRIGGERS, problems);

    const docsPaths = pathFilter(docs, 'push', 'paths');
    if (docsPaths === null) {
      at(docs, topLevel(docs, 'on').start + 1, '`push.paths` is missing; the job would run on every push, or on none.');
    } else {
      compareAsSets(docs, docsPaths, '`push.paths`', DOCS_TRIGGER_PATHS, problems);
    }
    const docsIgnore = pathFilter(docs, 'push', 'paths-ignore');
    if (docsIgnore !== null) at(docs, docsIgnore.line, '`push.paths-ignore` is declared; the trigger is expressed only as `paths`.');

    if (trigger(docs, 'push') !== null) {
      const train = readWorkflowEnv(security.text, security.file, 'RELEASE_TRAIN_BRANCH');
      const stable = readWorkflowEnv(release.text, release.file, 'STABLE_BRANCH');
      const branches = readBranchFilter(docs.text, docs.file, 'push');
      for (const branch of [stable, train]) {
        if (!branches.some(p => matchesFilter(p, branch))) {
          at(docs, topLevel(docs, 'on').start + 1, `push filter [${branches.join(', ')}] does not cover "${branch}"; documentation pushes there would run no drift check.`);
        }
      }
    }

    // The execution contract: one job, the three steps without which a
    // documentation push is observed by a job that checks nothing, and no key
    // that could keep the job green while the drift check did not pass.
    const docsJobs = jobs(docs);
    if (docsJobs.length !== 1) {
      at(docs, topLevel(docs, 'jobs').start + 1, `declares ${docsJobs.length} jobs; exactly one, \`${DOCS_JOB_NAME}\`, is the contract.`);
    }
    const ciJobNames = ciJobs.map(j => j.name);
    for (const job of docsJobs) {
      if (job.name !== DOCS_JOB_NAME) at(docs, job.line, `job is named \`${job.name}\`, not \`${DOCS_JOB_NAME}\`.`);
      if (ciJobNames.includes(job.name)) {
        at(docs, job.line, `job \`${job.name}\` reuses a ci.yml job name; under a required check's name a path-filtered job would block or satisfy the ruleset on main by accident.`);
      }
      if (!job.uses.some(u => DOCS_JOB_CHECKOUT.test(u))) at(docs, job.line, 'job does not check out the repository (`actions/checkout`).');
      if (!job.uses.includes(DOCS_JOB_SETUP)) at(docs, job.line, `job does not run \`${DOCS_JOB_SETUP}\`; \`check:drift\` needs the installed toolchain.`);
      if (!job.run.includes(DOCS_JOB_RUN)) {
        at(docs, job.line, `job has no step whose \`run:\` is exactly \`${DOCS_JOB_RUN}\`; this checker reads that inline one-line form only.`);
      }
      for (const control of job.controls) {
        at(docs, control.line, `job declares \`${control.key}:\`; the Docs job must be unconditional and must fail the run — it is the only observer of a push ci.yml skips.`);
      }
    }

    // Coverage, over the two lists as written rather than as pinned.
    if (ignore !== null && docsPaths !== null) {
      for (const file of tracked) {
        if (ignore.entries.some(p => matchesPathFilter(p, file)) && !docsPaths.entries.some(p => matchesPathFilter(p, file))) {
          at(docs, 1, `tracked file \`${file}\` is ignored by ci.yml but does not trigger docs.yml; a push changing only it would be observed by no workflow.`);
        }
      }
    }
  }

  // ── The tracked tree: liveness of the allowlist as written ───────────────
  for (const pattern of ignore?.entries ?? []) {
    if (!tracked.some(file => matchesPathFilter(pattern, file))) {
      at(ci, ignore?.line ?? 1, `\`${pattern}\` matches no tracked file; a dead allowlist entry is drift and keeps vouching for paths that no longer exist.`);
    }
  }

  return problems;
}

function main(): void {
  const problems = checkWorkflowPaths(REPO_ROOT);
  if (problems.length > 0) {
    throw new Error(
      `[workflow-paths] ${problems.length} problems:\n${formatProblems(problems)}\n\n` +
        'The documentation allowlist decides when CI does not run. Change the checker and the workflow together, or not at all.'
    );
  }
  console.log(
    `[workflow-paths] ok — ci.yml ignores exactly the ${CI_DOCUMENTATION_PATHS_IGNORE.length} documentation patterns, all live and ` +
      "all observed by docs.yml's drift job, which triggers on push and nothing else and runs unconditionally; " +
      'no path filter on pull_request, security.yml or release.yml; ' +
      `\`${CI_GATE_NAME}\` runs always() under \`shell: ${CI_GATE_SHELL}\` and needs every other ci.yml job.`
  );
}

// The real check runs only as the CLI entrypoint, so the fixture suite can
// import the functions without executing `main()` against the live repository.
if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
