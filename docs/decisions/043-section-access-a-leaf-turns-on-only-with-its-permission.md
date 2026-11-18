# ADR-043 — Section Access: a Leaf Turns On Only With Its Permission

## Status

Accepted

## Context

A section override, per user or per role, changes visibility only; it never grants a resource
permission ([ADR-042](042-resource-action-permissions-session-only-builder-for-maintenance-reads.md),
keeping [ADR-038](038-resource-action-permissions-grants-follow-section-visibility.md)'s invariant).
The static defaults are checked against the role grants by `sectionHierarchy.test.ts`; the writes
were not. An administrator could turn on a leaf for a role, or a user, without the permission the
leaf maps to in `SECTION_TO_PERMISSION`: the page then appeared in the menu and its reads answered
FORBIDDEN, and nothing said so at save or in the editor (#262).

The writes and their validation are [ADR-027](027-section-access-leaf-overrides-and-validated-defaults.md)'s;
this record adds one rule to them and changes nothing it decides.

## Decision

- **The writes.** `sectionAccess.set` and `sectionAccess.setRoleDefaults` turn a leaf on — an
  override `true`, a role default `enabled` — only for a role holding the leaf's mapped permission
  (`sectionPermissionHeld` in `@luke/core`, the predicate the resolver's RBAC fallback also uses).
  Otherwise they refuse with `BAD_REQUEST`, naming the section, the permission and the role. Turning
  a leaf off, removing an override, `disabled` and `auto` are never refused for a missing permission;
  the recovery guard on `settings.users` stays as it is.
- **Holding the check.** `sectionAccess.set` reads the target user's role under a row lock held
  until it commits (`FOR SHARE`), so a concurrent role change waits instead of landing between the
  check and the write. Role permissions are static, so `setRoleDefaults` needs no lock.
- **Stored violations.** Data that already breaks the rule — written before it, brought in by a
  restore or a script, or left by a later role change — is never changed. The API lists it at every
  start, one warning per violation with ids and section keys only, and the access dialogs show such a
  leaf as on with its missing permission, switchable off.
- **The dialogs.** A leaf the role cannot read is shown off and unavailable, with the permission in
  a tooltip; a parent with nothing under it the role may turn on likewise. Switching a parent on
  skips the leaves the role cannot read. A refused save shows the server's message.

## Consequences

- An enabled section no longer stands for a page whose reads the role is refused, for every write
  made through the API. The rule holds at the commit of each write, not as a permanent invariant:
  violations created afterwards are reported at the next start and in the dialogs.
- A page that queries without a permission gate of its own is protected by this rule rather than by
  a gate added to the page.
- Navigation derived from privileges (#221) would remove section overrides and this rule with them.

## Errata

Appended under [ADR-030](030-documentation-architecture-canonical-language-and-historical-records.md); the sections above are unchanged.

- **2026-11-15 — Consequences, first item, "for every write made through the API".** Not every API write: a role change through `users.update` can leave an enabled override or role default on a leaf the new role cannot read, without refusal. Only `sectionAccess.set` and `sectionAccess.setRoleDefaults` check the rule; the next sentence of that item, violations created afterwards are reported, covers this case.
- **2026-11-18 — Decision, "The writes" and "Holding the check", and the erratum of 2026-11-15.** `users.approvePending` also turns leaves on, through `applySectionOverride` and `setOverride`: the same check under the same `FOR SHARE` lock, against the role the approval has just written ([ADR-044](044-pending-user-approval-in-one-transaction.md)).
