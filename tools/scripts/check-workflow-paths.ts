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
 * - `security.yml` and `release.yml` carry no path filter at all. For
 *   `security.yml` that single whole-file scan is also what keeps a filter off
 *   its `pull_request`: one prohibition, not a second one stacked in front of
 *   it for the same paths.
 * - Both gated workflows declare `pull_request` as a readable indented block
 *   — an inline flow mapping is an error, not a pass — pinned to exactly the
 *   activity set below. The default set omits `edited`, which is what
 *   retargeting a pull request fires, so without the pin a PR moved onto a
 *   protected target produces no run and a required gate sits Pending on a
 *   head SHA nothing judged. One list for both files: the hazard belongs to
 *   `pull_request`, not to either gate. Branch *targets* differ and are not
 *   compared here — `check-workflow-branches.ts` owns ci.yml's, and
 *   security.yml's exact-`main` pin sits at its own call site.
 * - `security.yml` declares exactly the trigger set below and
 *   carries a second aggregate job — `Security
 *   gate` — of the same shape as ci.yml's, standing for the scans that judge a
 *   pull request. Its `needs` is derived from the file's own jobs minus the
 *   three that are deliberately outside it (the two weekly OSV jobs and the
 *   failure notifier), so a scan job added later is a missing `needs` entry
 *   rather than a silently ungated one. Every other job must carry exactly one
 *   job-level `if:`, the one its set is pinned to — `SECURITY_CONDITIONS`
 *   holds each expression next to the reason it is that one, which is also the
 *   text reported when it drifts.
 * - Neither `ci.yml` nor `security.yml` declares `continue-on-error:` anywhere,
 *   at any indent, and every occurrence is reported. Both files now carry an
 *   aggregate gate that accepts the literal `success` and nothing else, and
 *   `continue-on-error:` is precisely what turns a failure into that word:
 *   the gate would then report green over a job nobody fixed. Scanned as text,
 *   so a job the line reader does not recognise is covered too, and
 *   deliberately overlapping the per-job checks for the same reason.
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
 * `Security gate`: the same aggregate, standing for the scans that judge a
 * pull request. Its condition carries a second clause because, unlike ci.yml,
 * this workflow also runs on a schedule — a run in which all three of its
 * dependencies are skipped by design and the failure notifier, not this job,
 * is the signal.
 */
export const SECURITY_GATE_NAME = 'Security gate';
export const SECURITY_GATE_IF = "${{ always() && github.event_name != 'schedule' }}";
export const SECURITY_GATE_STEP = 'Require every scan to have succeeded';

/**
 * The interpreter the pinned script's semantics belong to, declared on the
 * step rather than inherited from the runner default — which is not part of
 * any contract and would change under the job without a diff here. What runs
 * the line decides whether it asserts anything at all: `shell: echo {0}` would
 * print the script and exit 0, a green gate that never looked at a result.
 * One declaration exactly, so a second one cannot quietly win.
 *
 * Unprefixed, like the two below: both gates are judged by this one script,
 * under this one interpreter, reading this one expression.
 */
export const GATE_SHELL = 'bash';

/** A gate's only input, bound to `RESULTS`: every dependency's result, space separated. */
export const GATE_RESULTS = "${{ join(needs.*.result, ' ') }}";

/**
 * The gate's whole body, pinned as a literal because it *is* the semantics:
 * it accepts the exact string `success` and rejects everything else, so
 * `failure`, `cancelled`, `skipped` and any result GitHub adds later fail
 * closed. It counts its arguments before looping because that is not
 * redundant: a `needs` that resolved to nothing, or to whitespace, would
 * otherwise iterate zero times and pass. The test suite executes this exact
 * string against each of those results rather than only comparing it.
 */
export const GATE_RUN =
  'echo "results=$RESULTS"; set -- $RESULTS; [ $# -gt 0 ] || exit 1; for r in "$@"; do [ "$r" = success ] || exit 1; done';

/**
 * security.yml's complete trigger set, compared as a set for the same reason
 * docs.yml's is: `merge_group` and `pull_request_target` would each add a run
 * of these scans under rules nobody chose here, and losing `pull_request`
 * would retire the pre-merge gate without a word.
 */
export const SECURITY_TRIGGERS = ['push', 'pull_request', 'schedule', 'workflow_dispatch'] as const;

/**
 * The pre-merge gate covers the stable line only. A train branch already has
 * every push scanned by `push.branches`, and a gate required on `develop-*` or
 * `release/*` would be a second remote contract to retire at each cycle
 * switch. Pinned here so the cycle-switch checklist never has to name it.
 */
export const SECURITY_PR_BRANCHES = ['main'] as const;

/**
 * The activity types both gated workflows must run on. GitHub's default set is
 * `opened`, `synchronize` and `reopened` — it does not include `edited`, which
 * is what retargeting a pull request fires. Left to the default, a pull request
 * moved onto a protected target produces no run for its new base, and a
 * required aggregate gate would sit Pending on a head SHA nothing ever judged.
 *
 * Gate-agnostic on purpose: one list, checked in both files, because the
 * hazard is a property of `pull_request` itself and not of either gate. Pinned
 * as a set, so dropping one is as loud as adding one.
 */
export const GATED_PULL_REQUEST_TYPES = ['opened', 'synchronize', 'reopened', 'edited'] as const;

/**
 * The jobs deliberately outside `Security gate`, which is what makes every
 * other job in the file one the gate must depend on. The weekly pair answers
 * a disclosure landing on code that has not changed — no pull request to
 * report on — and the notifier watches the others rather than being watched.
 */
export const SECURITY_WEEKLY_JOBS = ['osv-weekly', 'osv-weekly-release-train'] as const;
export const SECURITY_NOTIFIER_JOB = 'notify-on-failure';

/** The job-level `if:` each set is pinned to; why each is what it is lives in `SECURITY_CONDITIONS`. */
export const SECURITY_SCAN_IF = "github.event_name != 'schedule'";
export const SECURITY_WEEKLY_IF = "github.event_name == 'schedule' || github.event_name == 'workflow_dispatch'";
export const SECURITY_NOTIFIER_IF = "always() && github.event_name != 'pull_request' && contains(needs.*.result, 'failure')";

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
 * The key that lets a scan report success while it failed, anywhere in
 * security.yml and at any indent — including a job this file's line-oriented
 * job reader would not recognise, which is the point of scanning the text
 * rather than the parsed jobs.
 */
const CONTINUE_ON_ERROR_KEY = /^\s*(?:- )?continue-on-error:/;

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

/**
 * A scalar with its surrounding quotes removed — only a *matched* pair. An
 * unbalanced quote belongs to the value: a condition ends in
 * `!= 'schedule'`, and stripping that lone closing quote would compare a
 * mangled expression against the pinned one and call the difference drift.
 */
function unquote(value: string): string {
  const trimmed = value.trim();
  const quoted = /^(['"])(.*)\1$/.exec(trimmed);
  return quoted === null ? trimmed : quoted[2];
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
  // A comment never closes a block. It is legal at any indent inside one, and
  // treating it as the end truncated the job body there: every step-level
  // `if:` written after a 2-space comment became invisible, so a scan step
  // could carry a condition that skips it on a pull request while the job
  // still reported success to the gate.
  const closes = new RegExp(`^\\s{0,${indent}}[^\\s#]`);
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
 * that lists nothing is an error: an empty filter is not a narrower filter,
 * and an empty `branches` matches no branch at all.
 */
function triggerFilter(wf: Workflow, trig: string, key: 'paths' | 'paths-ignore' | 'branches' | 'types'): Filter | null {
  const t = trigger(wf, trig);
  if (t === null) return null;
  const k = section(wf.lines, new RegExp(`^ {4}${key}:`), 4, t.start + 1, t.end);
  if (k === null) return null;

  const filter = readList(wf, k, `${trig}.${key}`);
  if (filter.entries.length === 0) {
    const hazard =
      key === 'branches'
        ? 'an empty branch list matches no branch at all'
        : key === 'types'
          ? 'an empty activity list matches no event at all'
          : 'an empty filter is not a narrower filter';
    throw new WorkflowPathError(`${wf.file}:${filter.line}: \`${trig}.${key}\` lists nothing; ${hazard}.`);
  }
  return filter;
}

interface Job {
  /** The key under `jobs:`, which is what a `needs:` list names. */
  id: string;
  name: string | null;
  uses: string[];
  run: string[];
  /** The `name:` of each step, at step indent — not the job's own at 4. */
  stepNames: string[];
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
      stepNames: values(/^ {6,8}(?:- )?name:\s*(.+?)\s*$/),
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
 * repository itself declares passes its own — as a function where the right
 * diagnosis depends on which entry is surplus.
 */
function compareAsSets(
  wf: Workflow,
  filter: Filter,
  label: string,
  expected: readonly string[],
  problems: Problem[],
  surplus: string | ((entry: string) => string) = 'is not part of the pinned contract; widen the checker first, then the workflow'
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
        message: `${label} contains \`${entry}\`, which ${typeof surplus === 'function' ? surplus(entry) : surplus}.`,
      });
    }
  }
}

/**
 * Which pinned condition a security.yml job answers to. Membership is asked
 * once, here: the same answer decides both the job's own `if:` and whether
 * `Security gate` must depend on it, so the two can never disagree.
 */
type SecurityJobClass = 'scan' | 'weekly' | 'notifier';

const SECURITY_WEEKLY = new Set<string>(SECURITY_WEEKLY_JOBS);

function securityClass(id: string): SecurityJobClass {
  if (SECURITY_WEEKLY.has(id)) return 'weekly';
  if (id === SECURITY_NOTIFIER_JOB) return 'notifier';
  return 'scan';
}

const SECURITY_CONDITIONS: Record<SecurityJobClass, { expr: string; why: string }> = {
  scan: {
    expr: SECURITY_SCAN_IF,
    why: 'a scan the gate depends on must run on every trigger the gate reports for; narrower, it is skipped on a pull request and the gate then fails on a skipped dependency rather than on a finding',
  },
  weekly: {
    expr: SECURITY_WEEKLY_IF,
    why: 'the weekly pair answers the schedule and a manual dispatch, and is deliberately no part of the pull-request gate',
  },
  notifier: {
    expr: SECURITY_NOTIFIER_IF,
    why: 'on a pull request the gate is the signal, reported on the PR itself, and an issue per failed candidate is noise nobody closes',
  },
};

/**
 * The `pull_request` shape both gated workflows must declare: a readable
 * indented block, and exactly the approved activity set.
 *
 * Branch targets are deliberately not checked here — they differ between the
 * two files, `check-workflow-branches.ts` owns ci.yml's, and security.yml's
 * exact-`main` pin lives at its own call site with the reason it is `main`
 * only. What is shared is the activity set and the requirement that the
 * trigger be readable at all.
 */
function checkGatedPullRequest(wf: Workflow, problems: Problem[]): void {
  const block = trigger(wf, 'pull_request');
  if (block === null) {
    // Declared but unreadable is an error, never a pass: `triggers()` sees the
    // key on any form, `trigger()` only on the indented block one. An inline
    // flow mapping — `pull_request: {branches: [x], types: [y]}` — would
    // otherwise skip every pin below in silence.
    if (triggers(wf).includes('pull_request')) {
      throw new WorkflowPathError(
        `${wf.file}: \`pull_request\` is declared in a form this checker cannot read; it expects \`  pull_request:\` with an indented block, and anything else leaves its branches, types and path filters unchecked.`
      );
    }
    problems.push({
      file: wf.file,
      line: topLevel(wf, 'on').start + 1,
      message: '`pull_request` is missing; the aggregate gate would never report on a pull request, and a ruleset requiring it would block every merge.',
    });
    return;
  }

  const types = triggerFilter(wf, 'pull_request', 'types');
  if (types === null) {
    problems.push({
      file: wf.file,
      line: block.start + 1,
      message: '`pull_request` declares no `types`; the default set omits `edited`, so a retargeted pull request would produce no run and leave the gate Pending on a head SHA nothing judged.',
    });
    return;
  }
  compareAsSets(wf, types, '`pull_request.types`', GATED_PULL_REQUEST_TYPES, problems, 'is not one of the activities the gates are pinned to');
}

/** What distinguishes one aggregate gate from the other. */
interface GateContract {
  /** The job's `name:`: the context string a ruleset requires. */
  name: string;
  /** The job-level `if:`, and the only control key the job may carry. */
  condition: string;
  /**
   * Which of the file's other jobs the gate must depend on. Omitted means all
   * of them, which is ci.yml's contract; security.yml passes a predicate
   * because three of its jobs are deliberately outside the gate.
   */
  stands?: (job: Job) => boolean;
  /**
   * The step's `name:`, where the workflow pins one. Optional because only
   * security.yml's gate pins it: ci.yml's step carries a name too, but
   * bringing it under this contract is a change to ci.yml's, made on its own.
   */
  step?: string;
}

/**
 * The shape both aggregate gates share: a job that runs whatever its
 * dependencies did, reads their results and accepts nothing but `success`.
 * Only the name, the condition and the set it stands for differ, so the rest
 * is one contract checked in one place — including the script itself, which is
 * the same literal in both workflows.
 *
 * The `needs` set is derived from the file's own jobs rather than pinned, so a
 * job added to the workflow is a missing `needs` entry instead of a silently
 * unguarded one.
 *
 * @returns The job it judged, so gate membership is answered here once. A
 *   caller that re-derived it by name would disagree with this one in exactly
 *   the run where the name is wrong, and then describe the gate as if it were
 *   an ordinary job.
 */
function checkGate(wf: Workflow, contract: GateContract, all: Job[], problems: Problem[]): Job | null {
  const at = (line: number, message: string): void => {
    problems.push({ file: wf.file, line, message });
  };

  const named = all.filter(j => j.name === contract.name);
  if (named.length === 0) {
    at(
      topLevel(wf, 'jobs').start + 1,
      `no job is named \`${contract.name}\`; that is the context a ruleset can require in place of a list of job names ` +
        'nobody can keep in step with this file, and without it there is nothing to switch to.'
    );
    return null;
  }
  const [gate] = named;
  if (named.length > 1) {
    at(
      named[1].line,
      `${named.length} jobs are named \`${contract.name}\`; a required context names one job, and which of them answers for it is not this file's to decide.`
    );
  }

  compareAsSets(
    wf,
    gate.needs ?? { entries: [], line: gate.line },
    `\`${contract.name}\`'s \`needs\``,
    all.filter(j => j !== gate && (contract.stands?.(j) ?? true)).map(j => j.id),
    problems,
    // Two different mistakes: a name no job answers to — what a rename leaves
    // behind — and a real job this gate deliberately does not stand for.
    entry => (all.some(j => j.id === entry) ? 'is a job this gate deliberately does not stand for' : `is not a job in ${wf.file.replace(/^.*\//, '')}`)
  );

  const jobIf = gate.controls.find(c => c.level === 'job' && c.key === 'if');
  if (jobIf === undefined) {
    at(
      gate.line,
      `job declares no \`if:\`; without \`if: ${contract.condition}\` it is skipped in exactly the runs it exists to fail, ` +
        'and a skipped check blocks no merge once the ruleset requires it.'
    );
  } else if (jobIf.value !== contract.condition) {
    at(jobIf.line, `job declares \`if: ${jobIf.value}\`, not \`if: ${contract.condition}\`; anything else lets a failed dependency skip the gate.`);
  }
  for (const control of gate.controls) {
    if (control !== jobIf) {
      at(
        control.line,
        `job declares \`${control.key}:\` besides its job-level \`if: ${contract.condition}\`; ` +
          'a second condition or a `continue-on-error:` reports the gate green while a dependency did not succeed.'
      );
    }
  }

  if (gate.uses.length > 0) {
    at(gate.line, `job runs \`${gate.uses[0]}\`; the gate reads its dependencies' results and nothing else — no checkout, workspace setup, install or build.`);
  }
  if (gate.run.length !== 1 || gate.run[0] !== GATE_RUN) {
    at(
      gate.line,
      `job's steps are not exactly one \`run:\` equal to \`${GATE_RUN}\`; ` +
        'that literal is the gate\'s semantics, read here in its inline one-line form and executed by the test suite.'
    );
  }
  if (contract.step !== undefined && (gate.stepNames.length !== 1 || gate.stepNames[0] !== contract.step)) {
    at(gate.line, `job's steps are not exactly one named \`${contract.step}\`; the gate is that one step, and a second is work a gate does not do.`);
  }
  // What interprets the pinned script. Counted across the whole job, so a
  // job-level `defaults.run.shell` added beside the step's own is ambiguity
  // rather than a silent winner.
  if (gate.shells.length === 0) {
    at(gate.line, `job declares no \`shell:\`; the pinned script's semantics are \`${GATE_SHELL}\`'s, and the runner default is not part of any contract.`);
  } else if (gate.shells.length > 1) {
    at(
      gate.shells[1].line,
      `job declares ${gate.shells.length} \`shell:\` keys; exactly one decides what runs the pinned script, and two leave which one to GitHub's precedence rules.`
    );
  } else if (gate.shells[0].value !== GATE_SHELL) {
    at(
      gate.shells[0].line,
      `job declares \`shell: ${gate.shells[0].value}\`, not \`shell: ${GATE_SHELL}\`; ` +
        'another interpreter need not fail on what the script rejects, and one like `echo {0}` would report success without executing it at all.'
    );
  } else if (gate.shells[0].level !== 'step') {
    at(gate.shells[0].line, `job declares \`shell: ${GATE_SHELL}\` at job level; it belongs on the step that carries the script.`);
  }

  // The one step's `env:`, at its own indent. Read here rather than through a
  // general `env` field on every job: at this indent a job with `services:`
  // also has its container's variables, and a gate has neither.
  const results = gate.body.flatMap((l, k) => {
    const m = /^ {10}RESULTS:\s*(.+?)\s*$/.exec(l);
    return m === null ? [] : [{ value: unquote(m[1]), line: gate.line + 1 + k }];
  })[0];
  if (results === undefined) {
    at(gate.line, "job binds no `RESULTS`; the script would then read an empty variable rather than its dependencies' results.");
  } else if (results.value !== GATE_RESULTS) {
    at(results.line, `job binds \`RESULTS: ${results.value}\`, not \`${GATE_RESULTS}\`; a value that is not the dependency results makes the gate assert nothing.`);
  }

  return gate;
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

  const ignore = triggerFilter(ci, 'push', 'paths-ignore');
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
    const filter = triggerFilter(ci, trig, key);
    if (filter !== null) {
      at(
        ci,
        filter.line,
        `\`${trig}.${key}\` is declared; ci.yml's only path filter is \`push.paths-ignore\`. ` +
          'A filtered pull_request leaves the required checks on main Pending.'
      );
    }
  }

  // ── Both gated workflows: a readable pull_request, on the pinned activities ─
  for (const wf of [ci, security]) checkGatedPullRequest(wf, problems);

  // ── ci.yml: the aggregate gate the ruleset will require ───────────────────
  const ciJobs = jobs(ci);
  checkGate(ci, { name: CI_GATE_NAME, condition: CI_GATE_IF }, ciJobs, problems);

  // ── security.yml and release.yml: path-blind ──────────────────────────────
  // One prohibition covering every trigger, `pull_request` included: a
  // required check a path filter skipped reports Pending, not Passed.
  for (const wf of [security, release]) {
    const hit = wf.lines.findIndex(l => PATH_FILTER_KEY.test(l));
    if (hit !== -1) at(wf, hit + 1, 'declares a path filter; security scans every push and the release gate is never path-aware.');
  }

  // ── Both gated workflows: nothing may tolerate its own failure ────────────
  // A `continue-on-error:` job hands the aggregate gate a `success` result for
  // work that failed, which is the one input the pinned script accepts — so
  // the gate reports green over a job nobody fixed. It applies to ci.yml for
  // exactly the same reason it applies to security.yml: both now carry an
  // aggregate that reads its dependencies' results and nothing else.
  //
  // Scanned as text rather than through the parsed jobs, so a job the
  // line-oriented reader does not recognise is covered too; every occurrence
  // is reported, because fixing the first must not hide the second until the
  // following run.
  for (const wf of [ci, security]) {
    wf.lines.forEach((line, i) => {
      if (CONTINUE_ON_ERROR_KEY.test(line)) {
        at(wf, i + 1, 'declares `continue-on-error:`; a job that reports success while it failed is worth less than no job, and the aggregate gate would inherit that success.');
      }
    });
  }

  // ── security.yml: the pre-merge gate for pull requests on main ────────────
  compareAsSets(security, { entries: triggers(security), line: topLevel(security, 'on').start + 1 }, '`on`', SECURITY_TRIGGERS, problems);

  // security.yml's own branch pin. ci.yml's targets belong to
  // check-workflow-branches; what both files share — a readable trigger and
  // the activity set — is asserted for each by `checkGatedPullRequest`.
  if (trigger(security, 'pull_request') !== null) {
    const prBranches = triggerFilter(security, 'pull_request', 'branches');
    if (prBranches === null) {
      at(
        security,
        topLevel(security, 'on').start + 1,
        '`pull_request` declares no `branches`; it would then report on pull requests against every branch, including the trains this gate must never be required on.'
      );
    } else {
      compareAsSets(security, prBranches, '`pull_request.branches`', SECURITY_PR_BRANCHES, problems, 'is not the stable line; the pre-merge gate targets `main` only');
    }
  }

  const securityJobs = jobs(security);
  const securityGate = checkGate(
    security,
    {
      name: SECURITY_GATE_NAME,
      condition: SECURITY_GATE_IF,
      step: SECURITY_GATE_STEP,
      stands: job => securityClass(job.id) === 'scan',
    },
    securityJobs,
    problems
  );

  // The next two checks are defined relative to the gate, so with no gate
  // there is nothing they could say that would not mislead: the gate's own
  // job would be read as an ordinary scan and told to carry a scan's
  // condition, and the notifier would be told to watch the one job it must
  // not. The missing gate is already reported; that is the thing to fix.
  if (securityGate !== null) {
    // Every job but the gate is pinned to the condition of the set it belongs
    // to. Without this the gate's dependencies are only as dependable as
    // whatever condition they happen to carry.
    for (const job of securityJobs) {
      if (job === securityGate) continue;
      const { expr, why } = SECURITY_CONDITIONS[securityClass(job.id)];
      const conditions = job.controls.filter(c => c.key === 'if');
      const jobIf = conditions.find(c => c.level === 'job');
      if (jobIf === undefined) {
        at(security, job.line, `\`${job.id}\` declares no job-level \`if:\`; it runs on every trigger this workflow has, and ${why}.`);
      } else if (jobIf.value !== expr) {
        at(security, jobIf.line, `\`${job.id}\` declares \`if: ${jobIf.value}\`, not \`if: ${expr}\`; ${why}.`);
      }
      for (const extra of conditions) {
        if (extra !== jobIf) {
          at(security, extra.line, `\`${job.id}\` declares a second \`if:\`; a step-level condition can skip the work while the job still reports success.`);
        }
      }
    }

    // The notifier watches the scans directly rather than through the gate, so
    // its `needs` is every job but itself and the gate. Derived, which is also
    // what catches a reference a job rename left behind.
    const notifier = securityJobs.find(j => j.id === SECURITY_NOTIFIER_JOB);
    if (notifier === undefined) {
      at(security, topLevel(security, 'jobs').start + 1, `no job \`${SECURITY_NOTIFIER_JOB}\`; a failure on a push or on the weekly run would be reported nowhere.`);
    } else {
      compareAsSets(
        security,
        notifier.needs ?? { entries: [], line: notifier.line },
        `\`${SECURITY_NOTIFIER_JOB}\`'s \`needs\``,
        securityJobs.filter(j => j !== notifier && j !== securityGate).map(j => j.id),
        problems,
        'is not a job it can watch; the notifier needs every job but itself and the gate'
      );
    }
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

    const docsPaths = triggerFilter(docs, 'push', 'paths');
    if (docsPaths === null) {
      at(docs, topLevel(docs, 'on').start + 1, '`push.paths` is missing; the job would run on every push, or on none.');
    } else {
      compareAsSets(docs, docsPaths, '`push.paths`', DOCS_TRIGGER_PATHS, problems);
    }
    const docsIgnore = triggerFilter(docs, 'push', 'paths-ignore');
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
      `\`${CI_GATE_NAME}\` runs always() under \`shell: ${GATE_SHELL}\` and needs every other ci.yml job; ` +
      `\`${SECURITY_GATE_NAME}\` needs every security.yml scan job, on pull requests targeting ${SECURITY_PR_BRANCHES.join(', ')}; ` +
      `both gated workflows pin pull_request types [${GATED_PULL_REQUEST_TYPES.join(', ')}] and tolerate no failure of their own.`
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
