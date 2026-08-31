/**
 * Behavioral proof for the ADR index completeness check.
 *
 * The gate was installed *after* the index was brought current, deliberately:
 * a checker that ships red teaches people to skip it. That ordering means the
 * green baseline proves nothing on its own, so the negative cases below are
 * what actually establish that the gate blocks — and the positive case is here
 * too, because a rule that fires on a correct index is worse than no rule.
 *
 * The gate keeps the human index consistent with the tracked ADR corpus. It is
 * not ADR discovery: `luke-audit` reads the files under `docs/decisions/`
 * directly and stays independent of whether the index is complete.
 *
 * Status is not asserted anywhere. The repository carries two ADR header
 * formats (`## Status` and `**Status**:`), and an ADR's status is a semantic
 * fact under human decision. The checker stays on what is structural.
 *
 * Run: `pnpm test:tools`
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';

import {
  ADR_MISSING_FROM_INDEX,
  DUPLICATE_ADR_NUMBER,
  INDEX_ENTRY_WITHOUT_FILE,
  VALID_ADR_REPO,
  type RepoFiles,
} from './__fixtures__/docs/adrRepo';
import { checkAdrIndex } from './check-docs-integrity';
import { type Problem } from './lib/report';

const created: string[] = [];

after(() => {
  for (const dir of created) rmSync(dir, { recursive: true, force: true });
});

/** The checker discovers ADRs with `git ls-files`, so the fixture needs a repo. */
function repo(files: RepoFiles): string {
  const dir = mkdtempSync(join(tmpdir(), 'luke-adr-'));
  created.push(dir);

  for (const [path, contents] of Object.entries(files)) {
    const full = join(dir, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, contents);
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

function problemsFor(files: RepoFiles): Problem[] {
  const problems: Problem[] = [];
  checkAdrIndex(repo(files), problems);
  return problems;
}

test('a complete, consistent index reports nothing', () => {
  assert.deepEqual(problemsFor(VALID_ADR_REPO), []);
});

test('the baseline actually discovers the ADRs it vouches for', () => {
  // Guards against the opposite failure: a green result because discovery
  // returned nothing rather than because the index was correct.
  const problems: Problem[] = [];
  const count = checkAdrIndex(repo(VALID_ADR_REPO), problems);
  assert.equal(count, 2);
});

test('an ADR missing from the index fails', () => {
  const problems = problemsFor(ADR_MISSING_FROM_INDEX);
  assert.ok(
    problems.some(p => /002-second\.md` non compare nell'indice/.test(p.message)),
    `expected a missing-from-index problem, got: ${JSON.stringify(problems)}`
  );
});

test('a duplicate ADR number fails', () => {
  const problems = problemsFor(DUPLICATE_ADR_NUMBER);
  assert.ok(
    problems.some(p => /numero ADR duplicato/.test(p.message)),
    `expected a duplicate-number problem, got: ${JSON.stringify(problems)}`
  );
});

test('an index entry with no corresponding ADR file fails', () => {
  const problems = problemsFor(INDEX_ENTRY_WITHOUT_FILE);
  assert.ok(
    problems.some(p => /non è un ADR tracciato/.test(p.message)),
    `expected a dangling-index-entry problem, got: ${JSON.stringify(problems)}`
  );
});
