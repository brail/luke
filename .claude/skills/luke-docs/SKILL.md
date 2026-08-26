---
name: luke-docs
description: >
  Documentation generator and maintainer for the Luke monorepo. Three modes:
  readme (creates/updates README.md at every level with luke-docs markers),
  inline (JSDoc on TypeScript exports, tRPC procedure comments, Prisma ///
  field docs), adr (validates docs/decisions/ ADRs against the codebase and
  maintains the index). Use when asked to generate, update, or normalize
  documentation. Modes: /luke-docs readme | inline | adr | (all in sequence).
  Supports --since <git-ref> and --dry-run.
argument-hint: '[readme|inline|adr] [--since <git-ref>] [--dry-run]'
context: fork
agent: general-purpose
---

# Luke Docs — Documentation generator and maintainer

Three modes:

| Mode     | What it does                                                                                       | Details reference                |
| -------- | ---------------------------------------------------------------------------------------------------- | --------------------------------- |
| `readme` | Creates/updates the `README.md` files at every level (root, `apps/*`, `packages/*`, `docs/`)         | `references/readme-templates.md` |
| `inline` | Normalizes source-code comments: JSDoc on TS exports, tRPC comments, Prisma field docs (`///`)       | `references/inline-rules.md`     |
| `adr`    | Validates the ADRs in `docs/decisions/` against the codebase, updates Status, maintains the index    | `references/adr-rules.md`        |

No mode in $ARGUMENTS → run `readme` → `inline` → `adr` in sequence, combined report.

**Before running a mode, read its file in `references/`** — it contains
templates, merge logic, and mandatory quality checklists.

**Also read `.claude/skills/luke-shared/audit-protocol.md`** and apply the
sections its applicability table assigns to `/luke-docs`: §1 scoping and §7
concurrent sessions — you write files, so §7.2 applies to you.

---

## Mandatory rules (take precedence over everything else)

1. **Read before write** — never generate content for a file without having
   read it first.
2. **No SQL, no migrations, no test runner** — `schema.prisma` is read as
   text; never `prisma migrate/generate`, `pnpm db:*`, `pnpm test`.
3. **Parallel agents: max 3** simultaneously.
4. **Preserve markers** — never overwrite content outside the
   `luke-docs:start/end` markers. Marker integrity and internal-link
   resolution are **not** verified here: `tools/scripts/check-docs-integrity.ts`
   checks them, blocking in CI. It's pure parsing, and parsing entrusted to an
   LLM is a level-4 control where a level-2 one is enough.
5. **Dry-run** — with `--dry-run`, print the plan without writing any file.
6. **No placeholders** — never `TBD`, `TODO`, `…`, `{to be filled in}` in
   generated text. If information is missing: omit the section and flag it
   in the report.
7. **Never touch**: `.planning/`, `CLAUDE.md`, `lessons.md`, `lessons-archive.md`.
8. **Always a final report** — files created/updated/unchanged + symbols
   documented + flagged issues.
9. **Commit suggestion** at the end: `docs: update readme tree, inline comments and adr validation [luke-docs]`

## Language

| Context                                                | Language     |
| -------------------------------------------------------- | ------------- |
| Inline comments (JSDoc, tRPC `/** */`, Prisma `///`)      | **English**  |
| README.md (all levels) and ADRs                          | **Italian**  |

No exception for Italian domain terms (e.g. "stagione"→season,
"campionario"→collection/catalog, "reso"→return): always translate, even in
inline comments. See CLAUDE.md, Development Patterns section, rule 14.

---

## `--since <git-ref>` flag (optional)

Limits the work to only the files changed relative to the ref. Before Phase 1:

```bash
git diff --name-only <git-ref> HEAD
```

- `inline`: only process `.ts` / `.prisma` files in the diff
- `readme`: regenerate a workspace's README only if at least one of its files
  is in the diff, or if the README doesn't exist yet
- `adr`: only revalidate ADRs whose statements reference files in the diff;
  always regenerate the index

Empty list → stop: `No relevant file changed relative to <git-ref>. Nothing to do.`

---

## `readme` mode

**Phase 1 — Explore (mandatory).** Read in order:

1. Root `package.json` (workspaces, scripts, engines) + `turbo.json`
2. For every workspace: `package.json`, `src/index.ts(x)`, existing `README.md`
3. `.env.production.example` + env policy in `CLAUDE.md` — env var catalog
   (enforcement is `assertEnvPolicy()` in `apps/api/src/server.ts`)
4. `apps/api/prisma/schema.prisma` — model names only
5. `apps/api/src/routers/` — list of router files (names, not content)
6. `apps/web/src/app/` — 2-level directory tree
7. `docs/` — recursive listing of `.md` files (H1 titles, path)
8. `.planning/ROADMAP.md` — only to understand direction (don't reproduce)

Build a dictionary: `workspace → { name, description, dependents[], envVars[], exports[], scripts[], routerNamespaces[] }`.

**Phase 2 — Generate README** using the templates in
`references/readme-templates.md`: root + apps (max 3 in parallel) →
packages (max 3 in parallel) → `docs/README.md`.

**Phase 3 — Semantic consistency:** package names in "Used by"/"Internal
dependencies" match the real names; sections omitted for missing information
are flagged in the report.

Link resolution and marker integrity are **not** to be verified by hand:
`pnpm check:drift` checks them in CI. If it fails, the link must be fixed or
removed — never added to an exceptions list, or the checker becomes furniture.

---

## `inline` mode

**Phase 1 — Audit (mandatory).** Build the target list:

- `packages/**/src/**/*.ts`: exports without JSDoc, drifted JSDoc, `//` on public exports
- `apps/api/src/routers/**/*.ts`: procedures without `/** */` or without input/output/RBAC permission
- `apps/api/prisma/schema.prisma`: fields and models without `///`

**Phase 2-4 — Write** following the templates and merge logic in
`references/inline-rules.md`: package JSDoc (max 3 in parallel) → tRPC
comments (max 3 routers in parallel) → Prisma field docs.

---

## `adr` mode

**Phase 1 — Discover:** read the files in `docs/decisions/`; for each one
extract the title, `Status`, and key statements from the Decision section.
If `docs/decisions/` doesn't exist: flag it in the report and stop.

**Phase 2 — Validate** against the codebase (max 3 ADRs in parallel) per
`references/adr-rules.md`. Only modify the `Status` field.

**Phase 3 — Regenerate the index** `docs/decisions/README.md`.

---

## Final report (mandatory format)

```
=== luke-docs report ===

README:
  Created:     N files
  Updated:     N files
  Unchanged:   N files
  Sections omitted (missing info): [list]

INLINE:
  JSDoc added:      N symbols
  JSDoc updated:    N symbols
  tRPC comments:    N procedures
  Prisma fields:    N fields
  Flagged stale code: N

ADR:
  Validated:           N
  Confirmed:           N  (Status unchanged)
  Potentially stale:   N  (list with detail)
  Not verifiable:      N
  Index updated:       docs/decisions/README.md

Suggested commit:
  docs: update readme tree, inline comments and adr validation [luke-docs]
```
