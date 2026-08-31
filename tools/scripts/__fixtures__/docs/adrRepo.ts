/**
 * A minimal repository with an ADR directory and its generated index.
 *
 * Declared as data rather than committed as files, for the same reason as the
 * platform fixtures: a fixture `docs/decisions/*.md` would be discovered by the
 * real checker's own `git ls-files` when it runs against Luke, and reported as
 * an ADR missing from Luke's index.
 */

/** Files of a repository, keyed by path relative to its root. */
export type RepoFiles = Record<string, string>;

function adr(number: string, title: string): string {
  return `# ADR-${number} — ${title}\n\n## Status\n\nAccepted\n\n## Contesto\n\nFixture.\n`;
}

function index(rows: string[]): string {
  return [
    '# Decisioni architetturali',
    '',
    '<!-- luke-docs:start:adr-index -->',
    '| # | Titolo | Status |',
    '|---|--------|--------|',
    ...rows,
    '',
    '*Ultimo aggiornamento: 2026-08-31*',
    '<!-- luke-docs:end:adr-index -->',
    '',
  ].join('\n');
}

const ROW_001 = '| [001](001-first.md) | First | Accepted |';
const ROW_002 = '| [002](002-second.md) | Second | Accepted |';

/** Complete and consistent: every ADR indexed exactly once, every row resolving. */
export const VALID_ADR_REPO: RepoFiles = {
  'docs/decisions/001-first.md': adr('001', 'First'),
  'docs/decisions/002-second.md': adr('002', 'Second'),
  'docs/decisions/README.md': index([ROW_001, ROW_002]),
};

/** An ADR exists but the index stops short of it — the 013/014 situation. */
export const ADR_MISSING_FROM_INDEX: RepoFiles = {
  ...VALID_ADR_REPO,
  'docs/decisions/README.md': index([ROW_001]),
};

/** Two files claim the same number, so every citation of it is ambiguous. */
export const DUPLICATE_ADR_NUMBER: RepoFiles = {
  ...VALID_ADR_REPO,
  'docs/decisions/002-second-copy.md': adr('002', 'Second, again'),
};

/** The index advertises a decision whose file is gone. */
export const INDEX_ENTRY_WITHOUT_FILE: RepoFiles = {
  ...VALID_ADR_REPO,
  'docs/decisions/README.md': index([
    ROW_001,
    ROW_002,
    '| [003](003-missing.md) | Never written | Accepted |',
  ]),
};
