# luke-docs — Documentation audit rules (`audit` mode)

`audit` is read-only. It identifies documentation impact and semantic
documentation drift; it never edits a file, creates a report artifact, stages
work, or suggests that a write happened.

The canonical language and documentation-impact rules are in `CLAUDE.md`.
ADR-015 records their rationale. This reference defines how to inspect and
report; it does not create a second policy.

## Boundary with other owners

This mode asks whether current documentation accurately describes the code,
configuration, operations, and accepted decisions in scope. It does **not** ask
whether the code complies with `CLAUDE.md` or an Accepted ADR; that is
`/luke-audit`'s domain.

Use this direction test:

- documentation claim contradicted by observed repository fact →
  documentation drift, owned here;
- code contradicted by a normative project rule or Accepted ADR → code
  compliance, report as `owned by /luke-audit, not judged here`;
- documentation and code both conflict with an Accepted ADR → report the
  documentation drift and separately identify the code-compliance question as
  out of mode. Never reinterpret the ADR to make either side fit.

Mechanical marker pairing, relative links, ADR-index completeness, and other
implemented structural checks belong to
`tools/scripts/check-docs-integrity.ts`. Consume a reported failure when it
matters, but do not reproduce those parsers through LLM inspection. Semantic
accuracy remains here unless and until a deterministic rule genuinely decides
it.

## Authorities to read

After resolving scope through `SKILL.md` and `audit-protocol.md` §1:

1. Read `CLAUDE.md` and the Accepted ADRs relevant to the scoped change.
2. Read each current document that owns or describes the scoped surface.
3. Read the executable manifests, configuration, schemas, public interfaces,
   workflows, or source files needed to verify each material claim.
4. Follow documentation links only as far as needed to test whether the
   affected reader journey stays coherent. A default diff audit is not a
   disguised full-corpus audit.

The generated ADR index is navigation, not authority. Read ADR files directly.
Manifests and executable configuration are authoritative for observed facts;
Accepted ADRs and the stable `CLAUDE.md` constitution are authoritative for
normative decisions, per `governance-map.md` §4.

## Documentation-impact decision

Changes in these categories require an explicit impact assessment:

- architecture or repository boundaries;
- public, API, or externally observable behavior;
- configuration keys, defaults, validation, or environment policy;
- operational procedures and failure recovery;
- release, deployment, provenance, or artifact behavior;
- developer setup, commands, verification, or contribution workflows;
- repository structure, ownership, or navigation.

Report exactly one verdict:

- `Documentation impact: none` — cite the inspected documentation and the
  evidence showing its claims remain complete and true; or
- `Documentation impact: update required` — name each affected document, the
  claim or missing reader need, and the repository evidence that requires the
  update.

Do not infer that every code diff needs prose. Internal refactoring with no
changed contract, workflow, architecture, operation, or reader task can
correctly have no documentation impact. Conversely, the absence of a changed
Markdown file is not evidence that no update is required.

## Semantic checks

For documentation affected by the resolved scope, check:

1. **Accuracy** — commands, paths, exported surfaces, configuration behavior,
   ownership, and operational claims still match the repository.
2. **Completeness** — a material new or changed reader task is documented at
   the correct owned surface; avoid documenting private implementation detail.
3. **Consistency** — current documents do not make incompatible claims or
   maintain a translated second source.
4. **Authority** — generated description does not override an Accepted ADR,
   and an index does not paraphrase an authoritative title where exact reuse is
   required.
5. **Lifecycle** — current guidance is maintained; work items and frozen
   evidence are not presented as current reference material.
6. **Language** — new or mutable technical prose follows `CLAUDE.md`. Existing
   frozen bodies retain their language; new appended material is English.
7. **Reader path** — the relevant journey remains understandable from the
   repository README and its maintained indexes without inventing an unrelated
   link solely to satisfy reachability.

Do not rewrite or recommend translating a frozen historical body merely for
uniformity. Frozen status relaxes only the language expectation for the existing
body; it does not relax link, marker, index, or navigation integrity, and no
document can opt into the boundary with an inline marker. Do not design a
derived-translation layout before a real translated consumer is authorized.

## Finding standard

A text match is an investigation trigger, not a finding. Read the claim in
context and establish its audience, authority, and current repository evidence.

Every finding includes:

- status: `CONFIRMED` or `NEEDS DECISION`;
- documentation path and the specific claim or omission;
- evidence path and the fact that disagrees;
- reader or maintenance consequence;
- the smallest documentation correction, without applying it;
- baseline key `luke-docs:<relative path>:<rule slug>` when applicable.

Use `NEEDS DECISION` when the repository cannot establish which of two
documented behaviors is intended. Never turn a code/ADR contradiction into a
documentation rewrite without the owner's decision.

Apply `audit-protocol.md` §2, §3, §5, and §8. In particular, evaluate repeated
mechanical finding classes for promotion into the existing TypeScript checker.
Propose a rule only when syntax can decide it without semantic judgement.

## Report additions

In the mandatory `SKILL.md` report block, include:

```text
Documentation impact: none | update required
Confirmed findings: N
Needs decision: N
Suppressed by baseline: N
Files written: 0
```

Then list findings with their evidence and include the protocol's mandatory
`Promotion to rule` section. End with:

```text
Suggested commit:
  none — read-only audit
```

The report remains session-only. A tracked audit report would become another
document requiring ownership, navigation, and maintenance.
