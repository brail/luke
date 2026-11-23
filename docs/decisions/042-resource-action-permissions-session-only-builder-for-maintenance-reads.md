# ADR-042 — Resource:Action Permissions: a Session-Only Builder for Reads the Maintenance Window Needs

## Status

Superseded by [049 — Resource:Action Permissions: Previews, Dialog Reads and the Phase Catalog on Read](049-resource-action-permissions-previews-dialog-reads-and-the-phase-catalog-on-read.md)

## Context

[ADR-038](038-resource-action-permissions-grants-follow-section-visibility.md) is the record of the Resource:Action permission model. It kept [ADR-029](029-resource-action-permissions-one-builder-logged-refusals.md)'s rule of one authenticated builder with a permission, `protectedProcedure`, and its maintenance guard for every signed-in call except from whoever bypasses maintenance (`maintenance:update`).

The maintenance-mode state (`maintenance.mode.getStatus`) was a public read: the login page and the global maintenance gate asked for it before any session. Nothing before sign-in is to tell a caller about the application's state (#257), so the state now needs a session. A signed-in user who cannot bypass maintenance still needs it during the window: the lock screen shows it, and the gate decides from it whether to lock the page. On `protectedProcedure` that read is refused during the window like everything else, since the guard runs first.

The status vocabulary has no partial supersession ([ADR-030](030-documentation-architecture-canonical-language-and-historical-records.md)), so a change to ADR-038's builder rule is a new record of the whole model.

## Decision

This record supersedes ADR-038 as a whole, as ADR-038 did ADR-029. Its decisions, read with its errata, stand unchanged except where this section says otherwise.

### One further builder: `sessionProcedure`

`sessionProcedure` (`apps/api/src/lib/trpc.ts`) requires a valid session and nothing else: no maintenance guard, no permission. It is only for a read every signed-in user needs while maintenance refuses the rest. It carries no permission and never writes. Each use takes a reasoned `nosemgrep: luke-procedure-requires-permission` and is listed here:

- `maintenance.mode.getStatus` — the window's own state, which the lock screen shows.

`protectedProcedure` stays the one builder for everything else, `selfProcedure` the declared own-data exemption on it, and `publicProcedure` the builder for calls before a session.

## Consequences

- The maintenance state is no longer readable without a session; the login page asks nothing about the application's state, and a signed-out page shows no maintenance banner or lock screen. A login refused for maintenance is told so only once its password is proven.
- `.semgrep/rules/procedure-requires-permission.yml` covers both `protectedProcedure` and `sessionProcedure`: a new use of the session-only builder fails the build until it carries its reason, and joins the list above.
- CLAUDE.md rule 5 and the governance map are aligned with this record in a separate documentation change.
