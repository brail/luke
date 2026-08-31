/**
 * Behavioral proof for `check-skill-integrity.ts`.
 *
 * This checker gates `pnpm check:drift`, which gates `.husky/pre-push` and CI.
 * Every commit of the governance refactor passed through it, and it stayed
 * green throughout — which proves the repository conformed, not that the
 * checker works. Those are different claims, and only the second one is a gate.
 *
 * The execution-contract invariants were probed once during their
 * implementation cycle: each was driven red by mutating a real `SKILL.md`, then
 * restored. That proved they could fail on the day they were written and left
 * nothing behind. This suite is the permanent form of that proof — the missing
 * half of `audit-protocol.md`'s own rule that a checker never seen red is only
 * assumed to block.
 *
 * ## Why no temporary repository here
 *
 * Unlike the platform and docs suites, these cases need no `git init` and no
 * `mkdtemp`: `checkExecutionContract` reads a string and appends to an array.
 * Passing synthetic frontmatter directly is the whole fixture. Nothing in this
 * file touches `.claude/skills/` — the real skills are never mutated, which is
 * what made the original one-time proof unrepeatable.
 *
 * ## What is deliberately NOT covered
 *
 * The fan-out check (`agent: Explore` + forbidden subagent patterns) is left
 * untested here on purpose. It is gated behind the very declaration it
 * protects, so removing `agent: Explore` disables it silently while the gate
 * stays green. That is a known open finding awaiting owner classification;
 * pinning the current semantics with a passing test would make it look
 * settled. It is not.
 *
 * Run: `pnpm test:tools`
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  checkExecutionContract,
  isRepoPath,
  isSymbolRef,
} from './check-skill-integrity';
import { type Problem } from './lib/report';

/** Runs the contract check over one synthetic SKILL.md body. */
function run(content: string): Problem[] {
  const problems: Problem[] = [];
  checkExecutionContract('.claude/skills/fixture/SKILL.md', content, problems);
  return problems;
}

/** Asserts exactly one problem, and that it fails for the intended reason. */
function assertFailsWith(problems: Problem[], expected: string): void {
  assert.equal(problems.length, 1, `expected exactly one problem, got ${problems.length}`);
  assert.match(problems[0]!.message, new RegExp(expected));
}

const READONLY_BODY = '\n# Fixture\n\nRead-only. Do NOT modify any file.\n';

/** A forked read-only skill that satisfies every invariant. */
const VALID_FORK = `---
name: fixture
context: fork
agent: Explore
background: false
disallowed-tools: Edit, Write, NotebookEdit
---
${READONLY_BODY}`;

// ── Negative cases: each invariant must be able to go red ────────────────────

test('fork without an explicit background declaration fails', () => {
  const problems = run(VALID_FORK.replace('background: false\n', ''));
  assertFailsWith(problems, 'without an explicit `background: true\\|false`');
});

test('fork without an agent declaration fails', () => {
  const problems = run(VALID_FORK.replace('agent: Explore\n', ''));
  assertFailsWith(problems, 'without `agent:`');
});

test('read-only skill declaring no disallowed-tools fails, naming every missing tool', () => {
  const problems = run(VALID_FORK.replace('disallowed-tools: Edit, Write, NotebookEdit\n', ''));
  assertFailsWith(problems, 'does not remove Edit, Write, NotebookEdit');
});

test('read-only skill omitting one write tool fails — a partial exclusion is not an exclusion', () => {
  // The case a coarser rule would miss: two of three tools removed reads as
  // "disallowed-tools is present", but NotebookEdit still writes files.
  const problems = run(VALID_FORK.replace(', NotebookEdit', ''));
  assertFailsWith(problems, 'does not remove NotebookEdit');
});

test('SKILL.md with no frontmatter at all fails', () => {
  const problems = run('# Fixture\n\nNo frontmatter here.\n');
  assertFailsWith(problems, 'no frontmatter');
});

test('SKILL.md with unterminated frontmatter fails as having none', () => {
  // An unclosed fence is not frontmatter. It must not be parsed as a partial
  // one, or a truncated file would silently declare whatever it happened to
  // contain before the truncation.
  const problems = run('---\nname: fixture\ncontext: fork\n\n# Fixture\n');
  assertFailsWith(problems, 'no frontmatter');
});

// ── Positive cases: the same surface must stay green when correct ────────────
//
// Asserted with equal weight. An over-broad gate that reports correct skills as
// broken gets disabled within a week (`lessons.md`, on probing a new rule
// against a bait file), so each of these pins a case the rule must NOT fire on.

test('a fully compliant forked read-only skill produces no problems', () => {
  assert.deepEqual(run(VALID_FORK), []);
});

test('background: true is equally valid — the rule requires a declaration, not a value', () => {
  assert.deepEqual(run(VALID_FORK.replace('background: false', 'background: true')), []);
});

test('a non-forked skill needs neither background nor agent', () => {
  assert.deepEqual(run(`---
name: fixture
---
${READONLY_BODY}`.replace('Read-only. Do NOT modify any file.', 'Writes files.')), []);
});

test('a skill without the read-only marker is not required to disallow write tools', () => {
  // The write-tool rule keys on the marker, not on every skill: `luke-fix` and
  // `luke-docs` legitimately write.
  assert.deepEqual(
    run(`---
name: fixture
context: fork
agent: general-purpose
background: false
---

# Fixture

Applies approved changes.
`),
    []
  );
});

test('tool order and spacing in disallowed-tools do not matter', () => {
  assert.deepEqual(
    run(VALID_FORK.replace('Edit, Write, NotebookEdit', 'NotebookEdit,Write,  Edit')),
    []
  );
});

// ── Reference classification ────────────────────────────────────────────────
//
// The two predicates deciding what gets validated at all. If they stop matching,
// the checker reports green having verified nothing — the failure the
// zero-discovery guard in `main()` exists to catch. These pin the boundary.

test('isRepoPath accepts repo-shaped tokens and rejects the rest', () => {
  assert.equal(isRepoPath('apps/api/src/server.ts'), true);
  assert.equal(isRepoPath('references/adr-rules.md'), true, 'extension outside a known top dir');
  assert.equal(isRepoPath('packages/core/'), true);

  assert.equal(isRepoPath('hasPermission'), false, 'no slash');
  assert.equal(isRepoPath('https://example.com/a.ts'), false, 'URL');
  assert.equal(isRepoPath('@luke/core'), false, 'npm package, not a path');
  assert.equal(isRepoPath('apps/*/package.json'), false, 'glob');
  assert.equal(isRepoPath('<path>/SKILL.md'), false, 'placeholder');
});

test('isSymbolRef matches identifier() and nothing else', () => {
  assert.equal(isSymbolRef('buildApiUrl()'), true);
  assert.equal(isSymbolRef('$transaction()'), true);

  // Documented boundary: a bare `Skill()` in prose classifies as a symbol
  // reference and is resolved against apps/ and packages/. Writing it in a
  // skill file turns the gate red, which is why `luke-full` says "child skill
  // call" instead. Pinned so the behavior is deliberate rather than surprising.
  assert.equal(isSymbolRef('Skill()'), true);

  assert.equal(isSymbolRef('Skill(luke-audit)'), false, 'arguments — not a bare reference');
  assert.equal(isSymbolRef('apps/api'), false);
  assert.equal(isSymbolRef('()'), false);
});
