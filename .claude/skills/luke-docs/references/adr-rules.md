# luke-docs — ADR rules (`adr` mode)

Directory: `docs/decisions/` (MADR format). Language: **Italian**.

**An Accepted ADR is normative architecture, not documentation** — it outranks
the implementation until a human supersedes it
(`.claude/skills/luke-shared/governance-map.md` §4). This mode therefore
**reports** and does not decide: Context, Decision and Consequences are always
manual, and `Status` is only ever changed on an explicit user instruction.

Discovery reads the ADR **files** under `docs/decisions/`. The generated index
is for navigation and is not proof that no other ADR exists.

## MADR format (mandatory)

```markdown
# NNNN — Titolo della decisione

## Status

Accepted

## Contesto

Perché questa decisione era necessaria. Vincoli, forze in gioco, alternative considerate.

## Decisione

Cosa abbiamo scelto e perché.

## Conseguenze

Trade-off introdotti, vincoli architetturali, impatti su altri componenti.
```

Allowed values for `Status`:

- `Accepted` — active, validated decision
- `Deprecated` — no longer applicable, replaced by different practice
- `Superseded by [NNNN — Titolo](NNNN-titolo.md)` — replaced by a later ADR
- `Potentially stale — review needed` — **legacy value, do not write it.** It
  exists on ADRs written before this mode was read-only about status; leave
  those alone and report them for decision rather than rewriting either way

---

## Validation against the codebase

For every ADR with `Status: Accepted`, verify its key statements by looking
for evidence in the code.

**Search strategy by statement type:**

| Statement type                     | How to verify                                                  |
| ----------------------------------- | ---------------------------------------------------------------- |
| "We use library X"                  | Search for `X` in the relevant workspaces' `package.json`       |
| "We don't use Y"                    | Search for `Y` in every `package.json` — absence = confirmed    |
| "The model is called Z"             | Search for `model Z` in `schema.prisma`                         |
| "Function F exists in package P"    | Search for `export` + name in `packages/<P>/src/`                |
| "Pattern/flag/config C is active"   | Search in `CLAUDE.md`, `lessons.md`, relevant config files       |
| "Field status allows values V"      | Search for the matching enum in `schema.prisma` or `packages/core` |

**Outcome for each ADR:**

| Evidence found                                  | Action                                                                                    |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Confirmed — code matches the decision             | Leave `Status` unchanged                                                                       |
| Contradiction detected — code diverges            | **Report `ADR/CODE CONFLICT`. Change nothing.**                                                |
| Not verifiable — statement too abstract           | Leave unchanged, flag as "not automatically verifiable" in the report                         |
| ADR already `Deprecated` or `Superseded`          | Skip validation, include only in the index                                                    |

### `ADR/CODE CONFLICT`

A contradiction between an Accepted ADR and the code has **two** explanations,
and this mode cannot tell them apart:

1. the decision was superseded and nobody updated the ADR;
2. the implementation drifted away from a decision that still stands.

Assuming (1) is how an architectural decision gets repealed by an agent that
noticed the code disagreed with it. Report instead:

```
ADR/CODE CONFLICT — <NNN Title>
  Decision says: <the statement, quoted>
  Code shows:    <file:line and what it does>
  Not resolved here. Options: restore the implementation · supersede the ADR ·
  accept a new ADR.
```

Only after the user chooses may `Status` be edited, and only to what they chose.

**Never mark an ADR stale on ambiguity** — and now, never mark one stale at all
without an explicit decision.

---

## Index `docs/decisions/README.md`

Always fully regenerated, ascending numeric order:

```markdown
# Decisioni architetturali

<!-- luke-docs:start:adr-index -->

| #                      | Titolo                 | Status     |
| ---------------------- | ---------------------- | ---------- |
| [0001](0001-titolo.md) | Titolo della decisione | Accepted   |
| [0002](0002-titolo.md) | Titolo della decisione | Deprecated |

_Ultimo aggiornamento: {data corrente}_

<!-- luke-docs:end:adr-index -->
```

---

## ADR quality checklist (verify before closing)

- [ ] No ADR has had Context / Decision / Consequences modified
- [ ] No `Status` field was changed without an explicit user decision
- [ ] Every contradiction was reported as `ADR/CODE CONFLICT`, not resolved
- [ ] Every `Potentially stale` in the report has specific detail (what contradicts what)
- [ ] The `docs/decisions/README.md` index includes every file present in the directory
- [ ] No ADR was marked stale for ambiguity — only for explicit evidence
