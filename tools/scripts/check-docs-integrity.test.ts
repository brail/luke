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
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
import { checkAdrIndex, trackedMarkdown } from './check-docs-integrity';
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
    problems.some(p => /non è un ADR del corpus/.test(p.message)),
    `expected a dangling-index-entry problem, got: ${JSON.stringify(problems)}`
  );
});

/**
 * The inventory is tracked **and** present in the working tree.
 *
 * `git ls-files` answers from the index, but every reader here opens the working
 * tree, and the two diverge the moment a tracked file is deleted without being
 * staged. That state is ordinary — it is what `rm` followed by nothing looks
 * like — and it used to produce an unhandled `ENOENT` in the Markdown loop, an
 * ADR counted as present while its file was gone, and an ADR index whose
 * completeness check evaporated silently. Each case is pinned below.
 */

test('a tracked Markdown file deleted from the working tree leaves the corpus', () => {
  const dir = repo(VALID_ADR_REPO);
  const deleted = join(dir, 'docs/decisions/001-first.md');
  rmSync(deleted);

  // Precondition: git still lists it, which is exactly why filtering is needed.
  const listed = execFileSync('git', ['ls-files', 'docs/decisions/*.md'], {
    cwd: dir,
    encoding: 'utf8',
  });
  assert.match(listed, /001-first\.md/);

  const files = trackedMarkdown(dir);
  assert.ok(
    !files.includes(deleted),
    `deleted file still in the corpus: ${JSON.stringify(files)}`
  );
  assert.ok(files.length > 0, 'the surviving files must still be discovered');

  // The regression itself: reading every returned path must not throw ENOENT.
  for (const file of files) readFileSync(file, 'utf8');
});

test('an unreadable-because-absent file is excluded, not silently tolerated elsewhere', () => {
  // The filter is an inventory predicate, not a catch: what it removes is only
  // what the working tree does not contain. Everything it returns is still read
  // without a guard, so a present-but-unreadable file keeps failing the run.
  const dir = repo(VALID_ADR_REPO);
  rmSync(join(dir, 'docs/decisions/002-second.md'));

  const files = trackedMarkdown(dir);
  assert.deepEqual(
    files.map(f => f.slice(dir.length + 1)).sort(),
    ['docs/decisions/001-first.md', 'docs/decisions/README.md']
  );
});

test('a tracked ADR deleted from the working tree makes its index entry dangle', () => {
  const dir = repo(VALID_ADR_REPO);
  rmSync(join(dir, 'docs/decisions/002-second.md'));

  const problems: Problem[] = [];
  const count = checkAdrIndex(dir, problems);

  // Before: the file was counted as present, so the row pointing at it passed.
  assert.equal(count, 1, 'the missing ADR must not be counted as present');
  assert.ok(
    problems.some(p => /voce `002`.*non è un ADR del corpus/s.test(p.message)),
    `expected a dangling-entry problem for 002, got: ${JSON.stringify(problems)}`
  );
});

test('an ADR index deleted from the working tree is reported, not skipped', () => {
  const dir = repo(VALID_ADR_REPO);
  rmSync(join(dir, 'docs/decisions/README.md'));

  const problems: Problem[] = [];
  const count = checkAdrIndex(dir, problems);

  // Before: 0 with no problems, so the completeness check disappeared exactly
  // while the index was being dismantled — and `main`'s zero-discovery guard
  // could not catch it, being conditioned on that same file existing.
  assert.equal(count, 0);
  assert.ok(
    problems.some(p => /ADR nel working tree ma l'indice non c'è/.test(p.message)),
    `expected a missing-index problem, got: ${JSON.stringify(problems)}`
  );
});

test('a staged index deletion is reported too, not only an unstaged one', () => {
  // The state a commit and CI actually see. Keying the rule on whether the
  // index file is still tracked failed open exactly here: `git rm` drops it
  // from `git ls-files`, so the checker went quiet with both ADRs still in
  // place. The invariant belongs to the ADR corpus, not to git's index.
  // `-f` only because the fixture stages without committing; the end state is
  // the one that matters and is identical: gone from the index and from disk.
  const dir = repo(VALID_ADR_REPO);
  execFileSync('git', ['rm', '-q', '-f', 'docs/decisions/README.md'], {
    cwd: dir,
    stdio: 'ignore',
  });

  // Precondition: the path is gone from the index, the ADRs are not.
  const listed = execFileSync('git', ['ls-files', 'docs/decisions/*.md'], {
    cwd: dir,
    encoding: 'utf8',
  });
  assert.doesNotMatch(listed, /README\.md/);
  assert.match(listed, /001-first\.md/);

  const problems: Problem[] = [];
  const count = checkAdrIndex(dir, problems);

  assert.equal(count, 0);
  assert.ok(
    problems.some(p => /ADR nel working tree ma l'indice non c'è/.test(p.message)),
    `expected a missing-index problem, got: ${JSON.stringify(problems)}`
  );
});

test('the missing-index diagnostic recommends no whole-file rollback command', () => {
  // Repository policy forbids suggesting a whole-file rollback: it would
  // discard edits the author had not finished, which is a worse outcome than
  // the missing index. The advice names the intent, not a command.
  const dir = repo(VALID_ADR_REPO);
  rmSync(join(dir, 'docs/decisions/README.md'));

  const problems: Problem[] = [];
  checkAdrIndex(dir, problems);

  assert.ok(problems.length > 0, 'the diagnostic must exist to be constrained');
  for (const problem of problems) {
    assert.doesNotMatch(problem.message, /git\s+(checkout|restore|reset)/);
  }
});

test('a repository with no index and no ADRs is still skipped silently', () => {
  // The other half of the distinction: no index and no ADR corpus means the
  // repository never had the contract, which is not a problem to report.
  const dir = repo({ 'README.md': '# No decisions here\n' });

  const problems: Problem[] = [];
  const count = checkAdrIndex(dir, problems);

  assert.equal(count, 0);
  assert.deepEqual(problems, []);
});
