# ADR-015 — Documentation Architecture and Canonical Language

## Status

Accepted

## Context

Luke's technical documentation grew in two languages without a single canonical-language rule. Some current documents and generated templates were written in Italian, while newer architectural records and instruction files were written in English. This made language depend on the artifact or generator that happened to produce a file rather than on one repository-wide decision.

The ambiguity created practical drift. Generated text could reintroduce Italian after an English edit, navigation indexes could translate titles instead of reproducing their authoritative source, and the repository had no durable rule for deciding whether a translation was a source or a derivative. A manually maintained bilingual corpus would double the surfaces that must remain technically and semantically consistent.

The documentation also needs one navigable architecture. The repository landing page is the entry point; current technical material must be reachable from it through maintained indexes, while documentation that belongs to one application or package may remain beside its owner. Historical evidence has a different lifecycle from current guidance and must not be rewritten merely to make the current corpus stylistically uniform.

Product internationalization is a separate concern. Italian remains the current language of genuine end-user interaction until that interface is migrated through a dedicated i18n design. This temporary product-language state must not become an exception for developer-facing or technical material.

## Decision

English is the sole canonical language for mutable technical documentation, repository instructions, source comments, developer-facing diagnostics and logs, and other technical prose.

Italian is temporarily permitted only in genuine product UI and end-user interaction pending the separate i18n cycle. A string's location in application source does not decide the exception; its audience does.

Any future Italian documentation must be derived from a canonical English source. It must never be maintained as an equal, independently edited source. This decision does not prescribe a directory layout, metadata marker, translation system, or publication pipeline before a real derived translation exists.

The repository README is the single navigation root for governed Markdown. Every governed document must be reachable from it through relative links and maintained indexes. Documentation should remain close to the code that owns it when that improves responsibility and maintenance; reachability does not require centralizing every document in one directory. Reader-facing navigation is organized by purpose, while authority and mutability determine how a document may change.

Mechanical properties such as link resolution, reachability, index integrity, and required workspace documentation should be enforced deterministically. Semantic properties such as accuracy, completeness, and documentation impact remain subject to evidence-based human or agent review. This decision requires documentation impact to be declared with evidence at code-change handoff; its operational form is stated in the repository instruction file.

Frozen historical evidence retains its original language and lifecycle. It remains reachable and structurally valid, but its body is not rewritten solely to satisfy the canonical-language rule. New material appended to such a document is written in English; only its existing body is preserved. Current English indexes describe such material for readers.

As a one-time migration exception, pre-ADR-015 architectural records may be translated into English in place. The migration as a whole requires explicit owner authorization; each translation is meaning-preserving, requires human semantic review, preserves the original text in git history, and changes no status implicitly. The exception ends with this migration and does not apply to later Accepted ADRs, which are superseded rather than edited.

The reasoning recorded in the historical audit at Appendix W §W.7—that developer-facing prose could remain Italian merely for consistency with its surrounding file—is superseded. Local consistency does not override the audience-based language rule.

The canonical-language decision may be reopened only by a later superseding ADR explicitly authorized and accepted by the owner. A skill finding, an audit appendix, a checker change, or a standalone instruction-file edit may provide evidence for reconsideration but cannot supersede this decision.

Rejected alternatives:

- **Keep Italian as the documentation language.** Rejected because it preserves the split between technical artifacts and allows generators to reintroduce a second convention.
- **Maintain English and Italian as equal sources.** Rejected because two independently edited sources inevitably drift and neither remains authoritative.
- **Translate frozen historical evidence.** Rejected because historical fidelity and append-only guarantees outweigh stylistic uniformity.
- **Design a translation mechanism immediately.** Rejected because no derived translation is currently required; specifying an unused layout or pipeline would create a contract without an instance.
- **Introduce a documentation portal before repairing the corpus.** Rejected for now because the immediate defects are authority, accuracy, and navigation defects rather than rendering defects.

## Consequences

- Current technical documentation and generation rules require a bounded migration to English.
- Documentation changes are reviewed with the same evidence discipline as code, while deterministic checks cover only properties they can decide reliably.
- Existing Italian product text remains until the i18n cycle; developer-facing text does not inherit that temporary exception.
- Historical artifacts may remain Italian, but English navigation must make their purpose and frozen status clear.
- A future translated documentation set must be generated from English and include a way to detect source drift, but its implementation is deliberately deferred until there is a real consumer.
- Translating pre-existing ADRs is exceptional migration work, not a precedent for editing Accepted decisions.
- Adopting a future portal or different presentation layer does not create a second content source and does not change English's canonical status.
