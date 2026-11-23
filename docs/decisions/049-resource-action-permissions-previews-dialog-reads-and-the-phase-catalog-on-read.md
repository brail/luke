# ADR-049 — Resource:Action Permissions: Previews, Dialog Reads and the Phase Catalog on Read

## Status

Accepted

## Context

[ADR-042](042-resource-action-permissions-session-only-builder-for-maintenance-reads.md) is the record of the
Resource:Action permission model. A read-only query takes its resource's `read` permission. The exception for
reads that serve only an administration create/edit dialog, which take that dialog's permission, lived only in
`CLAUDE.md` rule 5. Two previews took their mutation's permission without any rule saying so:
`holidays.previewImport` and `phaseAlert.completionPreview`. And `phase.listAll`, the full phase list, kept
`phase_catalog:update` by an earlier decision (ADR-038, carried by ADR-042). That left a reader allowed into the
phase-catalog page with an empty table, although `phase.list` already returned the same rows on
`phase_catalog:read`.

The owner decided (#285, 2026-11-21, option a; 2026-11-23) the following. A preview takes the permission of the
mutation it precedes. The full phase list moves to the read permission, inactive phases staying readable by every
reader of the catalog. A Semgrep rule holds the exceptions to a visible marker. This changes what ADR-042 decides,
so it supersedes it ([ADR-047](047-documentation-architecture-decisions-in-force-index-by-area-and-short-records.md)).

## Decision

This record supersedes ADR-042 as a whole. Its decisions, read with ADR-038 and its errata, stand unchanged except
for the following.

- **Two exceptions to "a read takes `read`".**
  - A preview of the mutation it precedes takes that mutation's permission, because it shows what the mutation
    would do.
  - A read that serves only an administration create/edit dialog, or one of its tabs, takes that dialog's or
    tab's permission. A picker shared by create and edit accepts either permission.

  Each such query carries an in-chain comment right after its permission middleware:
  `// Rule 5: preview of <router.mutation>` or `// Rule 5: dialog-only read, <its sole consumer>`, then the reason.
  General-purpose reads stay on `read`.
- **The marker is enforced.** `.semgrep/rules/query-mutating-permission.yml` fails a `protectedProcedure` query
  gated by a literal permission whose action is not a non-mutating grant (`read`, `read_all`, `view_revisions`,
  `export`), unless the chain carries the marker. `*:*` is out of its scope. A check in the handler is not visible
  to it.
- **The phase catalog on read.** `phase.listAll` is removed. `phase.list({ includeInactive: true })` returns every
  phase, retired ones included, on `phase_catalog:read`, and the phase-catalog page reads it. This is the phase
  catalog's exception to "inactive rows only for administration": its retired phases label the history of the rows
  that passed through them, and the pickers derive from the same list. Every reader of the catalog sees all of its
  phases with all their fields. That was already true through `phase.list`, and the owner accepted it (2026-11-23).

## Consequences

- A new query gated by a mutating permission either carries the marker or moves to `read`.
- A reader allowed into the phase-catalog page sees the catalog, with every write action disabled.
- The `sessionProcedure` list stays in ADR-042's text: a further use is a new record that supersedes this one.
