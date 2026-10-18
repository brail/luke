# Result contract — the `luke-full` → `luke-fix` handoff

One producer, one consumer, one reason to exist.

`/luke-full` synthesizes what the specialist skills found. `/luke-fix` is a
**separate invocation** that has to route that synthesis to a remediator without
re-reading five reports and re-deriving who owns what. Everything below exists
to make that one crossing safe.

## What this contract is not

- **Not a format every skill emits.** `/luke-audit`, `/luke-bugs`,
  `/luke-security`, `/luke-deps` and `/luke-test` report Markdown, and
  `/luke-full` reads them in its own context. A producer with no machine
  consumer does not need a machine format, and inventing one would be five more
  things to keep in sync for nobody's benefit.
- **Not a common severity scale.** A skill's severities stay in its own
  vocabulary, verbatim (§2). `luke-audit` has no CRITICAL, `luke-security` has
  no LOW, `luke-deps` uses P0/P1/P2, `luke-test` reports QA GAP. Flattening
  those into one scale would invent precision the underlying findings do not
  have — the same defect as the 0–100 score this replaces.
- **Not a second place health is decided.** `/luke-full` computes the health
  state per its own synthesis rules; this contract only records the result.

---

## 1. Shape

```json
{
  "skill": "luke-full",
  "scope": ["apps/api/src/routers/brand.ts"],
  "health": "ACTION REQUIRED",
  "blockers": 1,
  "qaGap": true,
  "residualRisk": "MEDIUM",
  "suppressedByBaseline": 3,
  "findings": [
    {
      "id": "bugs-3",
      "title": "Sync failure is caught but never surfaced",
      "file": "apps/api/src/nav/sync.ts",
      "severity": "HIGH",
      "status": "CONFIRMED",
      "evidence": "semantic",
      "source": "luke-bugs",
      "domainOwner": "luke-bugs",
      "remediationOwner": "luke-fix"
    }
  ]
}
```

The Markdown report stays the human artifact and holds the scenarios, the
evidence and the proposed fixes. This footer carries only what routing needs;
it must not restate the report's prose.

## 2. Per-finding fields

| Field              | Meaning                                                                 |
| ------------------ | ----------------------------------------------------------------------- |
| `id`               | stable within one report, so a later message can refer to one finding    |
| `title`, `file`    | enough to locate it without parsing the report                           |
| `severity`         | **the producing skill's own word**, copied verbatim, never translated    |
| `status`           | §3 — whether the finding is established                                  |
| `evidence`         | §4 — what kind of proof stands behind it                                 |
| `source`           | which skill produced it                                                  |
| `domainOwner`      | which skill owns the invariant it violates                               |
| `remediationOwner` | which skill performs or routes the corrective action                     |

### Why ownership is two fields

Because they are two different responsibilities, and collapsing them would undo
the boundaries `governance-map.md` establishes.

`luke-bugs` owns runtime correctness — it decides what counts as a defect there,
and it is who a disagreement about the finding goes to. `luke-fix` owns making
an approved application-code change. A finding can be *owned* by one skill and
*fixed* by another, and a router that infers one from the other will eventually
send a platform finding to an application fixer.

```
runtime bug     source luke-bugs      domainOwner luke-bugs      remediationOwner luke-fix
platform drift  source luke-deps      domainOwner luke-deps      remediationOwner luke-deps
QA gap          source luke-test      domainOwner luke-test      remediationOwner luke-test
docs drift      source luke-docs      domainOwner luke-docs      remediationOwner luke-docs
```

`remediationOwner` is derived from `governance-map.md` §3, not from severity and
not from prose.

## 3. `status` — is the finding established?

The single most important field for safe routing.

| Status             | Meaning                                                        |
| ------------------ | -------------------------------------------------------------- |
| `CONFIRMED`        | the finding holds against the current code                     |
| `NEEDS DECISION`   | it depends on a question only the user can answer              |
| `ALREADY RESOLVED` | previously reported, fixed since                               |
| `SUPERSEDED`       | overtaken by a later change or decision                        |
| `NOT REPRODUCIBLE` | looked for and not found against the current code              |

**Only `CONFIRMED` findings are eligible for a remediation queue.** A
`NEEDS DECISION` item is never auto-queued, whatever its severity looks like:
severity says how bad it would be, `status` says whether we know it is real, and
acting on the first while ignoring the second is how an agent "fixes" a
deliberate architectural choice.

## 4. `evidence` — what stands behind it

Three values, deliberately coarse. This is not an ontology; it exists so a
router can tell proof from suspicion.

| Value           | Meaning                                                                  |
| --------------- | ------------------------------------------------------------------------ |
| `deterministic` | a checker, gate or test decided it — reproducible without an LLM          |
| `semantic`      | a skill reasoned to it from the code; real, but re-derive before acting   |
| `qa-gap`        | nothing currently proves the behavior either way (`luke-test`)            |

A `qa-gap` is not a defect report. Its remediation is evidence, not a code
change, which is why its `remediationOwner` is `luke-test` and never `luke-fix`.

## 5. Synthesis-level fields

Defined here so `/luke-fix` never has to reverse-engineer them.

| Field                  | Meaning                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------- |
| `health`               | the categorical state from `luke-full`'s synthesis rules — see `.claude/skills/luke-full/SKILL.md` |
| `blockers`             | count of findings that are **both** `CONFIRMED` **and** release-blocking in their own scale |
| `qaGap`                | true when at least one finding has `evidence: "qa-gap"` — see the note below                 |
| `residualRisk`         | LOW / MEDIUM / HIGH, as defined in `.claude/skills/luke-test/references/evidence-matrix.md` |
| `suppressedByBaseline` | count hidden by the baseline (protocol §2), so a low finding count is not mistaken for health |

`blockers` is a **count**, not a judgement: it is the input to `health`, not a
restatement of it.

### `qaGap` means missing evidence, and nothing else

It carries one meaning: **required deterministic evidence for a change is
missing or insufficient**, as `/luke-test` defines it. Because it feeds the
health state, widening it would corrupt the signal.

In particular, a governance rule that no checker enforces is **not** a QA GAP.
Most of this system's skill contracts are level-4 controls — prose that review
upholds — and `governance-map.md` §5 says so under *Known limit*. That is a
known governance limitation, reported as one. If every un-enforced rule became a
QA GAP, every run would carry `qaGap: true` and the field would stop meaning
anything.
