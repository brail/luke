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
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';

import {
  ADR_MISSING_FROM_INDEX,
  DIRECTORY_WITHOUT_INDEX_REPO,
  DUPLICATE_ADR_NUMBER,
  INDEX_ENTRY_WITHOUT_FILE,
  ORPHANED_DOCUMENT_REPO,
  VALID_ADR_REPO,
  VALID_REACHABLE_REPO,
  type RepoFiles,
} from './__fixtures__/docs/adrRepo';
import {
  checkAdrIndex,
  checkAdrTitleMatch,
  checkAnchors,
  checkLinks,
  checkMarkers,
  checkReachability,
  checkOwnedIndexSurfaces,
  headingAnchors,
  trackedMarkdown,
} from './check-docs-integrity';
import { type Problem } from './lib/report';

const created: string[] = [];

// Rules and examples: https://docs.github.com/en/get-started/writing-on-github/
// getting-started-with-writing-and-formatting-on-github/basic-writing-and-formatting-syntax#section-links
// Unicode follows the stated lowercase rule (the page's sample link retains Θ).
test('heading anchors follow GitHub section rules without collapsing spaces', () => {
  assert.deepEqual(
    [
      ...headingAnchors(
        [
          '# Sample Section',
          "## This'll be a _Helpful_ Section About the Greek Letter Θ!",
          '## This heading is not unique in the file',
          '## This heading is not unique in the file',
          '## Health & Readiness',
          '## Two  spaces',
          '## **Bold** and [link](https://example.invalid) with `foo_bar_baz`',
          '## Qualità 中文',
          '## same',
          '## same-1',
          '## same',
          'Setext heading',
          '---',
          '```md',
          '# Hidden',
          '[fake](#missing)',
          '```',
          '<!--',
          '# Also hidden',
          '-->',
        ].join('\n')
      ),
    ],
    [
      'sample-section',
      'thisll-be-a-helpful-section-about-the-greek-letter-θ',
      'this-heading-is-not-unique-in-the-file',
      'this-heading-is-not-unique-in-the-file-1',
      'health--readiness',
      'two--spaces',
      'bold-and-link-with-foo_bar_baz',
      'qualità-中文',
      'same',
      'same-1',
      'same-2',
      'setext-heading',
    ]
  );
});

test('fragments resolve locally, across files, through directory indexes and percent encoding', () => {
  const dir = repo({
    'README.md':
      '# Home\n[local](#home)\n[other](docs/guide.md#qualit%C3%A0)\n[index](docs/#index)\n',
    'docs/README.md': '# Index\n',
    'docs/guide.md': '# Qualità\n',
  });
  const problems: Problem[] = [];
  assert.equal(checkAnchors(dir, trackedMarkdown(dir), problems), 3);
  assert.deepEqual(problems, []);
});

test('broken fragments fail, including in frozen historical evidence', () => {
  const dir = repo({
    'docs/archive/history.md': '# History\n[bad](#missing)\n[encoding](#%ZZ)\n',
  });
  const problems: Problem[] = [];
  assert.equal(checkAnchors(dir, trackedMarkdown(dir), problems), 1);
  assert.deepEqual(problems, [
    {
      file: 'docs/archive/history.md',
      line: 2,
      message: 'fragment `#missing` does not resolve to a heading.',
    },
    {
      file: 'docs/archive/history.md',
      line: 3,
      message: 'fragment in `#%ZZ` has invalid percent encoding.',
    },
  ]);
});

test('fragment scope excludes examples, external links, untracked targets and custom HTML anchors', () => {
  const dir = repo({
    'README.md':
      '# Home\n[html](custom.md#custom)\n[external](https://example.invalid/#missing)\n' +
      '[top](#)\n[missing](absent.md#missing)\n`[inline](#missing)`\n~~~md\n[fenced](#missing)\n~~~\n' +
      '<!-- [comment](#missing) -->\n[untracked](local.md#missing)\n[real](#home)\n',
    'custom.md': '<a id="custom"></a>\n',
  });
  writeFileSync(join(dir, 'local.md'), '# Local\n');
  const problems: Problem[] = [];
  assert.equal(checkAnchors(dir, trackedMarkdown(dir), problems), 1);
  assert.deepEqual(problems, []);
});

test('custom-anchor examples do not suppress real heading validation', () => {
  const dir = repo({
    'README.md': '[bad](guide.md#missing)\n',
    'guide.md':
      '# Guide\n```html\n<a id="fenced"></a>\n```\n' +
      'Inline example: `<a id="inline"></a>`\n',
  });
  const problems: Problem[] = [];
  assert.equal(checkAnchors(dir, trackedMarkdown(dir), problems), 1);
  assert.deepEqual(problems, [
    {
      file: 'README.md',
      line: 1,
      message: 'fragment `guide.md#missing` does not resolve to a heading.',
    },
  ]);
});

function hub(contents: string): RepoFiles {
  return {
    'docs/README.md': `<!-- luke-docs:start:index -->\n${contents}\n<!-- luke-docs:end:index -->\n`,
  };
}

test('owned hub has exactly one ADR-index link; ordinary documents may cite many ADRs', () => {
  const dir = repo({
    ...hub('[Decisions](decisions/README.md)'),
    'ordinary.md':
      '[one](docs/decisions/001-first.md) [two](docs/decisions/002-second.md) [three](docs/decisions/003-third.md)',
  });
  const problems: Problem[] = [];
  checkOwnedIndexSurfaces(dir, problems);
  assert.deepEqual(problems, []);
});

test('owned hub rejects missing or duplicate index links and individual ADR links', () => {
  for (const [contents, expected] of [
    ['', ['expected exactly one link to `decisions/README.md`, found 0.']],
    [
      '[one](decisions/README.md) [two](./decisions/README.md)',
      ['expected exactly one link to `decisions/README.md`, found 2.'],
    ],
    [
      '[one](decisions/) [two](decisions/README.md)',
      ['expected exactly one link to `decisions/README.md`, found 2.'],
    ],
    [
      '[index](decisions/README.md) [ADR](decisions/001-first.md)',
      ['generated docs index must link the ADR index, not individual ADRs.'],
    ],
  ] as const) {
    const problems: Problem[] = [];
    checkOwnedIndexSurfaces(repo(hub(contents)), problems);
    assert.deepEqual(
      problems.map(problem => problem.message),
      expected
    );
  }
});

test('owned hub cannot evade the rule by removing its generated block', () => {
  const problems: Problem[] = [];
  checkOwnedIndexSurfaces(repo({ 'docs/README.md': '# Docs\n' }), problems);
  assert.deepEqual(problems, [
    {
      file: 'docs/README.md',
      line: 1,
      message: 'expected exactly one generated `index` block.',
    },
  ]);
});

test('a missing docs hub produces a diagnostic instead of an ENOENT crash', () => {
  const dir = repo(hub('[Decisions](decisions/README.md)'));
  rmSync(join(dir, 'docs/README.md'));
  const problems: Problem[] = [];
  checkOwnedIndexSurfaces(dir, problems);
  assert.deepEqual(problems, [
    {
      file: 'docs/README.md',
      line: 1,
      message:
        'documentation hub is missing; its owned index cannot be checked.',
    },
  ]);
});

test('ADR titles accept both numbered H1 formats and preserve status independence', () => {
  const dir = repo({
    ...VALID_ADR_REPO,
    'docs/decisions/001-first.md':
      '# ADR-001: First\n\nStatus: arbitrary legacy status\n',
  });
  const problems: Problem[] = [];
  assert.equal(checkAdrTitleMatch(dir, trackedMarkdown(dir), problems), 2);
  assert.deepEqual(problems, []);
});

test('ADR title mismatch fails without translating or normalizing the title', () => {
  const dir = repo({
    ...VALID_ADR_REPO,
    'docs/decisions/001-first.md': '# ADR-001 — Primo\n',
  });
  const problems: Problem[] = [];
  assert.equal(checkAdrTitleMatch(dir, trackedMarkdown(dir), problems), 2);
  assert.deepEqual(problems, [
    {
      file: 'docs/decisions/README.md',
      line: 6,
      message: 'ADR index title must match H1 exactly: `Primo`.',
    },
  ]);
});

test('ADR title check rejects duplicate rows, wrong targets, missing H1 and malformed cells', () => {
  const original = VALID_ADR_REPO['docs/decisions/README.md'];
  for (const [replacement, message] of [
    [
      original.replace(
        '| [002]',
        '| [001](001-first.md) | First | Accepted |\n| [002]'
      ),
      /duplicate ADR index entry/,
    ],
    [
      original.replace('(001-first.md)', '(002-second.md)'),
      /must target its tracked ADR file/,
    ],
    [original.replace('| First | Accepted |', ''), /must contain a title cell/],
  ] as const) {
    const dir = repo({
      ...VALID_ADR_REPO,
      'docs/decisions/README.md': replacement,
    });
    const problems: Problem[] = [];
    checkAdrTitleMatch(dir, trackedMarkdown(dir), problems);
    assert.equal(problems.length, 1);
    assert.match(problems[0].message, message);
  }
  const dir = repo({
    ...VALID_ADR_REPO,
    'docs/decisions/001-first.md': 'No H1\n',
  });
  const problems: Problem[] = [];
  checkAdrTitleMatch(dir, trackedMarkdown(dir), problems);
  assert.deepEqual(problems, [
    {
      file: 'docs/decisions/README.md',
      line: 6,
      message: 'ADR `001-first.md` has no matching numbered H1.',
    },
  ]);
});

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
    problems.some(p =>
      /002-second\.md` does not appear in the index/.test(p.message)
    ),
    `expected a missing-from-index problem, got: ${JSON.stringify(problems)}`
  );
});

test('a duplicate ADR number fails', () => {
  const problems = problemsFor(DUPLICATE_ADR_NUMBER);
  assert.ok(
    problems.some(p => /duplicate ADR number/.test(p.message)),
    `expected a duplicate-number problem, got: ${JSON.stringify(problems)}`
  );
});

test('an index entry with no corresponding ADR file fails', () => {
  const problems = problemsFor(INDEX_ENTRY_WITHOUT_FILE);
  assert.ok(
    problems.some(p => /not an ADR in the corpus/.test(p.message)),
    `expected a dangling-index-entry problem, got: ${JSON.stringify(problems)}`
  );
});

test('marker validation counts complete markers and reports every malformed pair', () => {
  const problems: Problem[] = [];
  const count = checkMarkers(
    'README.md',
    [
      'Prose mentioning luke-docs:start is not a marker.',
      '<!-- luke-docs:start:overview -->',
      '<!-- luke-docs:start:overview -->',
      '<!-- luke-docs:end:orphan -->',
      '<!-- luke-docs:end:overview -->',
      '<!-- luke-docs:start:tail -->',
    ],
    problems
  );

  assert.equal(count, 5);
  assert.deepEqual(problems, [
    {
      file: 'README.md',
      line: 3,
      message: 'block `overview` reopened: the one on line 2 is not closed.',
    },
    {
      file: 'README.md',
      line: 4,
      message: 'orphaned `luke-docs:end:orphan`: no matching opening marker.',
    },
    {
      file: 'README.md',
      line: 6,
      message:
        'block `tail` is never closed. Regeneration would overwrite everything that follows.',
    },
  ]);
});

test('link validation checks relative paths and reports only unresolved targets', () => {
  const dir = repo({
    'docs/source.md': '# Source\n',
    'docs/target.md': '# Target\n',
  });
  const problems: Problem[] = [];
  const count = checkLinks(
    join(dir, 'docs/source.md'),
    'docs/source.md',
    [
      '[target](target.md)',
      '[missing](missing.md#section)',
      '[anchor](#section)',
      '[remote](https://example.com)',
      '[template](${DOCS_ROOT}/README.md)',
    ],
    problems
  );

  assert.equal(count, 2);
  assert.deepEqual(problems, [
    {
      file: 'docs/source.md',
      line: 2,
      message: 'link `missing.md#section` does not resolve.',
    },
  ]);
});

test('reachability follows transitive links through a directory index', () => {
  const dir = repo(VALID_REACHABLE_REPO);
  const files = trackedMarkdown(dir);
  const problems: Problem[] = [];

  const reachable = checkReachability(dir, files, problems);

  assert.equal(
    files.length,
    3,
    'skill documentation must stay outside the corpus'
  );
  assert.equal(reachable, 3);
  assert.deepEqual(problems, []);
});

test('reachability reports every tracked document outside the root graph', () => {
  const dir = repo(ORPHANED_DOCUMENT_REPO);
  const files = trackedMarkdown(dir);
  const problems: Problem[] = [];

  const reachable = checkReachability(dir, files, problems);

  assert.equal(reachable, 3);
  assert.deepEqual(problems, [
    {
      file: 'docs/orphan.md',
      line: 1,
      message:
        'document is not reachable from `README.md`. Link it from the ' +
        'appropriate documentation index; do not add reachability exceptions.',
    },
  ]);
});

test('a directory link reaches only its tracked README index', () => {
  const dir = repo(DIRECTORY_WITHOUT_INDEX_REPO);
  const files = trackedMarkdown(dir);
  const problems: Problem[] = [];

  const reachable = checkReachability(dir, files, problems);

  assert.equal(reachable, 2);
  assert.deepEqual(problems, [
    {
      file: 'docs/guide.md',
      line: 1,
      message:
        'document is not reachable from `README.md`. Link it from the ' +
        'appropriate documentation index; do not add reachability exceptions.',
    },
  ]);
});

test('reachability fails closed when no link produces a graph edge', () => {
  const dir = repo({
    'README.md': '# Repository without links\n',
    'docs/orphan.md': '# Orphan\n',
  });
  const files = trackedMarkdown(dir);

  assert.throws(
    () => checkReachability(dir, files, []),
    /1 reachable, 1 orphaned.*link pattern may no longer match/s
  );
});

test('reachability fails closed when the declared navigation root is absent', () => {
  const dir = repo({ 'docs/guide.md': '# Guide\n' });
  const files = trackedMarkdown(dir);

  assert.throws(
    () => checkReachability(dir, files, []),
    /navigation root `README\.md` is not tracked and present/
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
  assert.deepEqual(files.map(f => f.slice(dir.length + 1)).sort(), [
    'docs/decisions/001-first.md',
    'docs/decisions/README.md',
  ]);
});

test('a tracked ADR deleted from the working tree makes its index entry dangle', () => {
  const dir = repo(VALID_ADR_REPO);
  rmSync(join(dir, 'docs/decisions/002-second.md'));

  const problems: Problem[] = [];
  const count = checkAdrIndex(dir, problems);

  // Before: the file was counted as present, so the row pointing at it passed.
  assert.equal(count, 1, 'the missing ADR must not be counted as present');
  assert.ok(
    problems.some(p =>
      /index entry `002`.*not an ADR in the corpus/s.test(p.message)
    ),
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
    problems.some(p =>
      /ADRs in the working tree but the index is missing/.test(p.message)
    ),
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
    problems.some(p =>
      /ADRs in the working tree but the index is missing/.test(p.message)
    ),
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
