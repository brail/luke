---
name: luke-docs
description: >
  Documentation generator and maintainer for the Luke monorepo. Three modes:
  readme (creates/updates the root README.md, apps/*/README.md,
  packages/*/README.md and docs/README.md, with luke-docs markers), inline
  (JSDoc on TypeScript exports, tRPC procedure comments, Prisma /// field
  docs), adr (validates docs/decisions/ ADRs against the codebase and
  maintains the index). Use when asked to
  generate, update, or normalize documentation. Modes: /luke-docs readme |
  inline | adr — one mode per invocation. Supports --since <git-ref> and
  --dry-run.
argument-hint: '<readme|inline|adr> [--since <git-ref>] [--dry-run]'
context: fork
agent: general-purpose
background: false
---

# Luke Docs — Documentation generator and maintainer

Three modes:

| Mode     | What it does                                                                                       | Details reference                |
| -------- | ---------------------------------------------------------------------------------------------------- | --------------------------------- |
| `readme` | Creates/updates root `README.md`, `apps/*/README.md`, `packages/*/README.md`, `docs/README.md`       | `references/readme-templates.md` |
| `inline` | Normalizes source-code comments: JSDoc on TS exports, tRPC comments, Prisma field docs (`///`)       | `references/inline-rules.md`     |
| `adr`    | Validates the ADRs in `docs/decisions/` against the codebase, reports conflicts, maintains the index | `references/adr-rules.md`        |

## Mode resolution — before anything else

**Invocation arguments:** $ARGUMENTS

Resolve the value above **first**: before reading any repository file, any
file in `references/`, the shared protocol, or running any git command. The
first whitespace-separated token is the mode. **One mode runs per invocation**
— there is no combined run; running all three documentation modes requires
three separate invocations.

Exactly these four forms are accepted, in this order and no other:

| Form                             | Effect                                        |
| -------------------------------- | --------------------------------------------- |
| `<mode>`                         | run `<mode>` on the default scope (§1)        |
| `<mode> --dry-run`               | plan only, write nothing                      |
| `<mode> --since <ref>`           | only files changed relative to `<ref>`        |
| `<mode> --since <ref> --dry-run` | both                                          |

`<mode>` is exactly `readme`, `inline` or `adr`, case-sensitive. `<ref>` is one
token not starting with `--`; whether git can resolve it is git's answer, given
later and before any write. Flag order is fixed: `--since <ref>` precedes
`--dry-run`, and the reverse is rejected. Quoting is not supported, so a ref
containing whitespace is not accepted.

**Anything else fails closed.** Print

```
luke-docs: usage — <readme|inline|adr> [--since <ref>] [--dry-run]
```

and stop, having read nothing and written nothing:

| Case                                | Example                                              |
| ----------------------------------- | ---------------------------------------------------- |
| no mode                             | bare invocation, or `--dry-run` alone                |
| unknown or differently-cased mode   | `readm`, `ADR`, `Readme`, `all`                      |
| a flag before the mode              | `--dry-run readme`                                   |
| an unknown positional               | `readme apps/api`, `readme inline`                   |
| an unknown flag                     | `readme --full`, `readme --force`                    |
| a duplicated flag                   | `readme --dry-run --dry-run`                         |
| `--since` without a non-flag value  | `readme --since`, `readme --since --dry-run`         |
| reverse flag order                  | `readme --dry-run --since HEAD~1`                    |
| tokens after the accepted form      | `readme --since HEAD~1 --dry-run extra`              |

## File ownership per mode

**Mode selection bounds what you write, never what you read.** Read whatever
the mode needs; write only the paths in its row.

| Mode     | Writes — and only these                                                                                                                                                                          | Never                                                                                                                     |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `readme` | root `README.md`; `apps/*/README.md`; `packages/*/README.md`; `docs/README.md` — inside the markers, or the whole file when it does not exist                                                      | `docs/decisions/README.md` (owned by `adr`); any README nested deeper than one level, until an explicit decision adds it   |
| `inline` | comments in `packages/**/src/**/*.ts`, `apps/web/src/lib/**/*.ts`, `apps/web/src/hooks/**/*.ts`, `apps/api/src/routers/**/*.ts`, `packages/db/prisma/*.prisma`, per `references/inline-rules.md` | every README; anything under `docs/`; any change to executable behaviour                                                   |
| `adr`    | `docs/decisions/README.md`; the `Status` line(s) of explicitly named ADR files, and only on an explicit user decision                                                                             | `docs/README.md` (owned by `readme`); ADR Context / Decision / Consequences, always manual                                 |

Rule 7's never-touch list below wins over every row.

A file outside your row that looks like it needs the work — a README under
`docs/decisions/` carrying markers, an ADR title disagreeing with the index, a
JSDoc gap noticed while reading `src/index.ts` — is **reported, not edited**:
list it in the final report as `owned by <mode>, not touched`. Noticing is not
authority to write.

**Before running the mode, read its file in `references/`** — it contains
templates, merge logic, and mandatory quality checklists.

**Also read `.claude/skills/luke-shared/audit-protocol.md`** and apply the
sections its applicability table assigns to `/luke-docs`: §1 scoping and §7
concurrent sessions — you write files, so §7.2 applies to you. **Of §1 step 2's
selector forms this skill accepts only `--since <ref>`** — the one its
`argument-hint` has always advertised. A `<path>` selector and `--full` are not
accepted, so there is today no invocation that regenerates the whole tree in one
pass; that is a deliberate limit, not an oversight, and widening it means adding
a form to the grammar above rather than guessing at one. The narrowing is this
skill's own, not a change to §1.

**Ownership**: `.claude/skills/luke-shared/governance-map.md`. This skill owns
generated documentation — README, JSDoc, Prisma field docs, ADR index — and no
architectural or platform decision. Within it, ownership is per mode: the table
above is where that is written, and every other statement of it points here.

---

## Mandatory rules (take precedence over everything else)

1. **Read before write** — never generate content for a file without having
   read it first.
2. **No SQL, no migrations, no test runner** — the `packages/db/prisma/*.prisma`
   files are read as text; never `prisma migrate/generate`, `pnpm db:*`, `pnpm test`.
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
   Never change an ADR's `Status` without an explicit user decision.
8. **No volatile platform facts in generated text** — a framework or tool is
   named, never versioned. Versions are read from the manifests at the moment
   anyone needs them (`.claude/skills/luke-deps/references/platform-policy.md`).
   A README that states a version is a second source of truth that drifts: the
   template here said `Next.js 15` while `apps/web` was on 16.
9. **Always a final report** — files created/updated/unchanged, the symbols
   documented (`inline` only), what stayed out of mode, and flagged issues.
   One block, for the mode that ran; see the report section below.
10. **Commit suggestion** at the end — the one for the mode that ran, from the
   table in the report section. Never a text naming a mode that did not run.

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
  is in the diff, or if the README doesn't exist yet. Root `README.md`
  regenerates when a root manifest or any workspace file is in the diff;
  `docs/README.md` when any `docs/**/*.md` is
- `adr`: only revalidate ADRs whose statements reference files in the diff, and
  regenerate the index — unless the diff is empty, which stops the run below
  before either happens

Empty list → stop: `No relevant file changed relative to <git-ref>. Nothing to do.`

---

## `readme` mode

**Phase 1 — Explore (mandatory).** Read in order:

1. Root `package.json` (workspaces, scripts, engines) + `turbo.json`
2. For every workspace: `package.json`, `src/index.ts(x)`, existing `README.md`
3. `.env.production.example` + env policy in `CLAUDE.md` — env var catalog
   (enforcement is `assertEnvPolicy()` in `apps/api/src/server.ts`)
4. `packages/db/prisma/*.prisma` — model names only (multi-file schema, split by domain)
5. `apps/api/src/routers/` — list of router files (names, not content)
6. `apps/web/src/app/` — 2-level directory tree
7. `docs/` — recursive listing of `.md` files (H1 titles, path). Input for
   `docs/README.md` only: the ADR titles it surfaces belong to `adr` mode, and
   noticing that `docs/decisions/README.md` disagrees with them is a report
   line, not work for this mode
8. `.planning/ROADMAP.md` — only to understand direction (don't reproduce)

Build a dictionary: `workspace → { name, description, dependents[], envVars[], exports[], scripts[], routerNamespaces[] }`.

**Phase 2 — Generate README** using the templates in
`references/readme-templates.md`, and no other README, in this order: root +
apps (max 3 in parallel) → packages (max 3 in parallel) → `docs/README.md`.
The order is fixed; the membership is not — regenerate only the targets the
resolved scope selected, plus any README in the ownership row that does not
exist yet. This is the same rule the `--since` section states, and it holds for
the default scope too.

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
- `apps/web/src/lib/**/*.ts` and `apps/web/src/hooks/**/*.ts`: same treatment
  (`references/inline-rules.md` holds the boundary — not `components`, not `app`)
- `apps/api/src/routers/**/*.ts`: procedures without `/** */` or without input/output/RBAC permission
- `packages/db/prisma/*.prisma`: fields and models without `///`

**Phase 2-4 — Write** following the templates and merge logic in
`references/inline-rules.md`: package JSDoc (max 3 in parallel) → tRPC
comments (max 3 routers in parallel) → Prisma field docs.

---

## `adr` mode

**Phase 1 — Discover:** read the files in `docs/decisions/`; for each one
extract the title, `Status`, and key statements from the Decision section.
If `docs/decisions/` doesn't exist: flag it in the report and stop.

**Phase 2 — Validate** against the codebase (max 3 ADRs in parallel) per
`references/adr-rules.md`. **Change no `Status` field.** An Accepted ADR is
normative until a human supersedes it, so a contradiction with the code is
reported as `ADR/CODE CONFLICT` and left for decision — see the reference for
why the alternative lets an agent repeal an architectural decision by noticing
the code disagrees with it.

**Phase 3 — Regenerate the index** `docs/decisions/README.md` — the only file
this mode regenerates; an ADR `Status` line is the one other thing it may
write, and only on an explicit user decision (see the ownership table).
`docs/README.md` links to this index and is readme-owned: a stale entry there
is reported as `owned by readme, not touched`.

---

## Final report (mandatory format)

One block, for the mode that ran. Never print a block — or a counter — for a
mode that did not run: the run reports what it did, not what the skill can do.

```
=== luke-docs report — <mode> ===

  <the counter lines for that mode, from the table below>

Out of mode (not touched): <path — owned by <mode>> | none

Suggested commit:
  <the commit line for that mode, from the table below>
```

| Mode     | Counter lines                                                                                                    | Commit line                                    |
| -------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `readme` | `Created` / `Updated` / `Unchanged` file counts; `Sections omitted (missing info)`                                | `docs: update readme tree [luke-docs]`         |
| `inline` | `JSDoc added` / `JSDoc updated` symbols; `tRPC comments`; `Prisma fields`; `Flagged stale code`                   | `docs: normalize inline comments [luke-docs]`  |
| `adr`    | `Validated`; `Confirmed`; `ADR/CODE CONFLICT` (with evidence, awaiting decision); `Not verifiable`; `Status changed` (normally 0); `Index updated` | `docs: update adr validation [luke-docs]`      |

The `Out of mode` line is **mandatory in every report**, `none` included: a
missing line and an empty one are different claims, and only one of them says
you looked.
