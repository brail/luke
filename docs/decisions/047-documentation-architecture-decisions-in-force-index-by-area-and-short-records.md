# ADR-047 — Documentation Architecture: Decisions in Force per Area, an Index by Area and Short Records

## Status

Accepted

## Context

[ADR-030](030-documentation-architecture-canonical-language-and-historical-records.md) is the record
of the documentation architecture and calls itself its single authority. It keeps Accepted records
immutable: a change of decision is a new record, a stale fact an erratum. Older successors restated
their predecessor in full to stand alone; later ones keep it by reference. Either way the current
rule of one area is spread over a chain of up to seven records, their errata and the records beside
them, and a superseded record can still hold the only text of a rule in force (#287).

The log is not the description of the system: arc42 describes the architecture in sections 4 to 8
(solution strategy, building blocks, runtime, deployment, cross-cutting concepts) and gives
decisions their own section 9, and Nygard's records are one or two pages. This record adds a
current description beside the log.
It changes what ADR-030 calls the single authority, so it supersedes it (ADR-030: when it is unclear
whether a change is an erratum, the record is superseded).

## Decision

This record supersedes ADR-030 as a whole. Its decisions stand unchanged except where this section
says otherwise. The canonical-language decision is not reopened; the rule for reopening it stands
and now reads on this record.

- **Areas.** Every record belongs to one area. The areas are the pages in `docs/decisions/in-force/`;
  adding, merging or renaming one is an ordinary documentation change. A superseded record has the
  area of the record at the head of its chain.
- **A page of decisions in force per area.** It states the current rules in short bullets, each
  linking the record that decides it and saying which operations the rule covers and what it
  excepts. It lists the area's records: those in force, superseded ones whose text a record in force
  still keeps, and related records of other areas. Where a record leaves a list to another
  maintained document, the page links that document and keeps no copy. The page is current guidance,
  kept up to date in the commit that adds a record, or an erratum correcting a fact the page states.
  It decides nothing: where a page and an Accepted record disagree, the record holds and the page is
  corrected. A rule appears on a page only with a record behind it.
- **The index by area.** `docs/decisions/README.md` lists every record once, under its area: records
  in force first, the others folded below. It is generated from the record files and the pages, and
  the documentation check compares it with them.
- **Short records.** A new record is one or two pages and states only what changes: the rule it
  adds, or what it replaces in the record it supersedes, which it links. It does not restate what
  stands; the page carries the whole picture. Supersession stays whole and errata stay for facts.
- **Review.** At each major release, and at least once a year, the records and pages are reviewed:
  statuses and kept clauses against the code, each page against its records and their errata, chains
  kept by reference, citations of superseded records. Findings become errata, page corrections, or
  proposals for a new record; the owner decides every status change and every new record. Each
  review is dated on the pages and listed in the index.

Rejected alternatives:

- **Rewrite or merge Accepted records into one current record per area.** Rejected: immutability
  stands, and the text nobody accepted would be the page's, where it is labelled as guidance.
- **A partial supersession or "amended by" status.** Rejected: the short whole supersession and a
  record beside already cover it, and a third relation would leave a partly live record readable as
  current, the reason ADR-030 gave.
- **Add this beside ADR-030 with an erratum.** Rejected: an erratum corrects a fact, and which
  record holds authority for the documentation architecture is not one.
- **Pages only, index left flat.** Rejected: a reader arriving by number still has to walk the chain
  to learn whether a record is in force.

Owner decision #106 a, 2026-11-21.

## Consequences

- ADR-030 is superseded; this record, read with ADR-030 and ADR-015 that it keeps, is the authority
  for the documentation language and architecture. New errata sections cite this record; existing
  ones stay as written.
- A reader learns an area's current rules from one page, and opens a record for the reasons.
- A page can be wrong, as any current document can. The check holds its structure; a correct link
  does not stop a summary that says more than its record. That is held by the independent
  verification of each page change, the review and `/luke-docs audit`.
- A rule now has up to three statements: the record, the page and, where agents need it,
  `CLAUDE.md`. The record is the authority for the decision; the other two follow it.
- Records before this one keep their length. A long chain kept by reference is shortened only by a
  new record the owner asks for, never by editing.
