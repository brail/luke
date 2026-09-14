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

/** A transitive graph whose directory link resolves through docs/README.md. */
export const VALID_REACHABLE_REPO: RepoFiles = {
  'README.md': '# Repository\n\n[Documentation](docs/)\n',
  'docs/README.md': '# Documentation\n\n[Guide](guide.md)\n',
  'docs/guide.md': '# Guide\n',
  '.claude/skills/example.md': '# Excluded skill documentation\n',
};

/** One tracked document is outside the graph rooted at README.md. */
export const ORPHANED_DOCUMENT_REPO: RepoFiles = {
  ...VALID_REACHABLE_REPO,
  'docs/orphan.md': '# Orphan\n',
};

/** A directory link must not imply that every Markdown descendant is indexed. */
export const DIRECTORY_WITHOUT_INDEX_REPO: RepoFiles = {
  'README.md': '# Repository\n\n[Visible](visible.md)\n[Docs](docs/)\n',
  'visible.md': '# Visible\n',
  'docs/guide.md': '# Guide without an index\n',
};

/**
 * Two workspaces declared by the globs, and three directories that are not
 * workspaces: `packages/notes` matches a glob but holds no manifest, `tools`
 * holds a manifest outside every glob, and `apps/web/fixtures/nested` holds one
 * deeper than `apps/*` reaches. The `package.json` files are data for the same
 * reason as the ADRs: committed, the real platform and documentation checkers
 * would discover them.
 */
const WORKSPACES_WITHOUT_CORE_README: RepoFiles = {
  'pnpm-workspace.yaml': 'packages:\n  - apps/*\n  - packages/*\n',
  'package.json': '{ "name": "fixture-root" }\n',
  'README.md': '# Repository\n',
  'apps/web/package.json': '{ "name": "web" }\n',
  'apps/web/README.md': '# Web\n',
  'apps/web/fixtures/nested/package.json': '{ "name": "nested" }\n',
  'packages/core/package.json': '{ "name": "core" }\n',
  'packages/notes/guide.md': '# Notes without a manifest\n',
  'tools/package.json': '{ "name": "tools" }\n',
};

/** Every workspace the globs declare has a tracked README. */
export const VALID_WORKSPACE_REPO: RepoFiles = {
  ...WORKSPACES_WITHOUT_CORE_README,
  'packages/core/README.md': '# Core\n',
};

/** `packages/core` is a workspace, and its README is missing. */
export const WORKSPACE_MISSING_README_REPO: RepoFiles =
  WORKSPACES_WITHOUT_CORE_README;

/**
 * `apps` itself holds a manifest and no README, above workspaces of its own.
 * Only a glob whose terminal `**` also matches zero levels discovers it, as
 * pnpm does once it appends `/package.json` to `apps/**`.
 */
export const WORKSPACE_PARENT_WITHOUT_README_REPO: RepoFiles = {
  ...VALID_WORKSPACE_REPO,
  'apps/package.json': '{ "name": "apps" }\n',
};
