# ADR-030 — Documentation Architecture, Canonical Language and Historical Records

## Status

Accepted

## Context

ADR-015 made English the canonical language of Luke's technical documentation and set its architecture: one navigation root, documentation beside the code that owns it, deterministic checks for mechanical properties and evidence-based review for the rest. It also made two exceptions to the canonical language. Frozen historical evidence kept its original language, described for readers by English indexes. And Accepted ADRs, once a one-time translation of the records older than ADR-015 was done, became immutable: superseded, never edited.

Two facts changed since.

The owner decided that the governed documentation must carry no Italian technical prose at the end of the documentation cycle, historical records included. A deterministic language check is meant to guard that state, and a check cannot hold a corpus to one language while a path-based exception keeps part of it in another. ADR-015 allows its canonical-language decision to be reopened only by a superseding ADR the owner authorizes and accepts; this is that record.

Accepted ADR bodies also accumulate statements of fact about the repository — a file path, the name of a rule or a procedure, an observed gap — that later changes make untrue without touching the decision. Under ADR-015 the only remedy was a superseding ADR, restating a whole decision to correct one sentence, so the statements stayed wrong: a review of the corpus found such statements in several Accepted ADRs, some of which would mislead a reader acting on them. The one in-place correction made meanwhile, a single sentence in ADR-019 that described a file the same change deleted, shows both the need and the absence of a rule for it.

## Decision

This record supersedes ADR-015 as a whole. Its decisions stand unchanged except where this section says otherwise.

English is the sole canonical language for mutable technical documentation, repository instructions, source comments, developer-facing diagnostics and logs, and other technical prose. Italian is temporarily permitted only in genuine product UI and end-user interaction pending a separate internationalization cycle; a string's audience decides the exception, not its location.

Any future Italian documentation is generated from a canonical English source and is never maintained as an equal, independently edited source, and it must come with a way to detect drift from that source. No directory layout, metadata marker, translation system or publication pipeline is prescribed before a real derived translation exists.

Local consistency never overrides the audience-based rule: developer-facing prose is not kept in Italian to match the file around it. ADR-015 superseded the contrary reasoning recorded in the historical audit at Appendix W §W.7, and that stands.

The repository README is the single navigation root for governed Markdown. Every governed document is reachable from it through relative links and maintained indexes. Documentation stays close to the code that owns it when that improves responsibility and maintenance; reachability does not require centralizing every document in one directory. Reader-facing navigation is organized by purpose, while authority and mutability determine how a document may change.

Mechanical properties such as link resolution, reachability, index integrity, required workspace documentation and the canonical language are enforced deterministically, to the extent a check can decide them. Semantic properties such as accuracy, completeness and documentation impact remain subject to evidence-based human or agent review. Documentation impact is declared with evidence at code-change handoff; its operational form is stated in the repository instruction file.

**Historical records are English too.** Frozen historical evidence keeps its lifecycle — append-only or immutable, never rewritten into current guidance — but not a second language. An Italian historical body is either translated, preserving its meaning and leaving its status, findings and chronology unchanged, or retired from the tree. In both cases git history keeps the original, and that is the archival record. A retired record stays traceable: the index that listed it keeps an English entry naming the record, its last path and the commit that holds it, current documents that linked it point to that entry, and documents that only cite it — frozen ledgers included — are not rewritten. The choice is made per document by the owner. Afterwards normal append-only or immutable handling resumes, and anything appended is written in English. ADR-015's clause preserving the original language of historical evidence is withdrawn.

**Errata for Accepted ADRs.** The Context, Decision and Consequences of an Accepted ADR are not edited, and its Status changes only to record a supersession or deprecation the owner authorized. A statement in those sections about the repository as it was — a path, a file, a rule, a procedure or route name, a count, an observed gap — that a later change made untrue may be corrected by an entry appended to a final errata section. Each entry is dated, written in English, locates or quotes the statement, says what is true now and cites the change or record that made it so. An erratum corrects a statement of fact and nothing else: if the correction would change what the ADR decides, requires or rejects, it is not an erratum and needs a superseding ADR. When it is unclear which, the ADR is superseded.

ADR-015's one-time translation of the records older than it is complete, and the exception that allowed it does not extend to any later record.

The canonical-language decision may be reopened only by a later superseding ADR explicitly authorized and accepted by the owner. A review finding, an audit appendix, a checker change or a standalone instruction-file edit may provide evidence for reconsideration but cannot supersede it.

Rejected alternatives:

- **Those ADR-015 rejected remain rejected:** keeping Italian as the documentation language, maintaining English and Italian as equal sources, designing a translation mechanism before a derived translation is needed, and introducing a documentation portal before repairing the corpus.
- **Keep historical bodies in their original language** (ADR-015's choice). A check could hold that boundary; it is rejected because the owner decided the governed documentation has one language, and an Italian body under an English index serves no current reader.
- **Translate every historical body.** Rejected as the only option: a record with no remaining reader costs a translation and a review. Retiring it gives up consulting it in the tree, not its content, which git history keeps and the index entry keeps findable.
- **Retire without a trace in the tree.** Rejected because citations of the record — in ledgers that are not rewritten — would lose the way to it; the index entry pinned to a commit is what keeps them traceable.
- **Supersede an ADR for every stale fact.** Rejected because it restates a whole decision to correct one sentence, and that cost is why the stale facts stayed.
- **Edit stale facts in place.** Rejected because an Accepted body would then carry text nobody accepted, and the line between correcting a fact and changing a decision would vanish from the file's history.
- **Supersede only the changed clauses of ADR-015.** Rejected because the status vocabulary has no partial supersession, and a partly live ADR-015 would leave its preservation clause readable as current.

## Consequences

- ADR-015 is superseded; this record is the single authority for the documentation language and architecture.
- Italian historical documents become English or leave the tree. The corpus has no language exception by path, so a deterministic language check can cover all of it, while remaining a regression guard rather than proof that no Italian is left.
- A retired record is read only through git history, located by the commit its index entry names.
- An Accepted ADR can state true things about the repository without a new decision. A reader checks its Errata section before acting on a factual statement, and can rely on its Decision section as accepted, because no erratum changes it.
- The boundary between an erratum and a superseding ADR is a judgment. Reviewers refuse an erratum that changes a requirement, and tooling may report candidate errata but does not write them.
- Existing Italian product text remains until the internationalization cycle; developer-facing text does not inherit that temporary exception.
- Adopting a future portal or a different presentation layer does not create a second content source and does not change English's canonical status.
