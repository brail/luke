# ADR-027 — Section Access: Leaf Overrides, Validated Role Defaults and Migrated Legacy Data

## Status

Accepted

## Context

[ADR-025](025-section-access-resolution-derived-parents.md) made a parent section derived from its children: on if and only if one of them is. Four things it left in place no longer fit that rule.

- **Data written before it.** Production resolved with ADR-021, where a parent decided on its own. The web layouts check only the parent (`apps/web/src/app/(app)/*/layout.tsx`), so a parent override closed or opened its whole group. After the upgrade such a row is inert: a per-user `false` on `admin` stops working and the group opens again. A stored role map whose parent value disagreed with its children follows the children instead. ADR-025 listed this as a deploy check; nothing translated the data.
- **The role-defaults reader.** `getRbacConfig` parsed `rbac.sectionAccessDefaults` with a bare `JSON.parse` and replaced a role's whole static map with the stored one. A missing or invalid entry fell to the permission fallback, which can grant what the static table denies. ADR-025's guarantees therefore held only for rows written through the API. A role-defaults matrix UI shipped in v1.0.0–v1.1.0, so a production row can be partial, carry `'auto'` and use pre-2.0 section names.
- **The one API section guard.** `storage.getConfig` and `storage.saveConfig` were guarded by `withSectionAccess('settings')`. Since parents are derived, that guard meant "any settings child". An administrator whose `settings.storage` was off, by override or kill switch, still read and wrote the S3 credentials.
- **The access dialogs.**
  - Switching a parent wrote overrides on kill-switched children the dialog showed as locked.
  - Both dialogs rendered live switches before the role defaults had loaded.
  - A save compared the edits with the latest query result, so a refetch could delete an override another administrator had written.
  - A failed approval attempt kept overrides and a role the retry no longer showed.

This record supersedes ADR-025. It restates the rules that survive and records the changes.

## Decision

### Hierarchy and resolution (as in ADR-025)

- `packages/core/src/rbac/sectionHierarchy.ts` derives the tree from the dot notation of `sectionEnum`; a section added as `x.y` joins `x` with no other edit.
- **A section with children** is on if and only if at least one child is. Its own override, role default and permission are not consulted.
- **A section without children** goes through four layers in `effectiveSectionAccess` (`packages/core/src/rbac/effectiveAccess.ts`):
  - **Layer 0, the kill switch** (`app.sections.disabled`), denies when the section or any section it is nested under is listed. `isGloballyDisabled` is the one predicate for it, shared with the access dialogs.
  - **Layer 1, the per-user override**, decides when present.
  - **Layer 2, the role default**, as built by the reader below.
  - **Layer 3, the permission fallback** (`SECTION_TO_PERMISSION`, `hasPermission`), is reached only by an explicit `'auto'` or by a role outside `Roles`, which it denies.

### Role defaults: one schema, read per entry, merged per section

- `sectionAccessDefaultsSchema` (`packages/core/src/schemas/rbac.ts`) describes a valid stored value: a partial record over `Roles` of partial records over `sectionEnum`, each `'enabled'`, `'disabled'` or `'auto'`. The registry entry and `setRoleDefaults` use it.
- `getRbacConfig` reads a stored row **entry by entry**:
  - roles and sections the code does not know are dropped, so a section removed from the enum does not cost the rest of the row;
  - an invalid value, a role whose value is not an object, and a row that is not a JSON object are ignored;
  - ignored entries are reported to the handler registered with `setRbacConfigWarningHandler`. The API registers its logger at startup. The handler receives keys only, never values, possibly more than once a minute; a handler that throws is ignored.
- **Merge per section** (`mergeSectionAccessDefaults`): role r gets the static table with the valid stored entries over it. An omitted or ignored entry takes its static value, never `'auto'`, for every row and not only for rows written through the API. A section added to the enum later takes its static value on a deployment that stores a map.
- **The failure mode is availability, not fail-closed.**
  - An ignored entry takes the static value, which can grant what an intended but corrupt denial would have refused.
  - Failing closed was rejected: `'disabled'` on a corrupt admin entry can lock every administrator out of user administration, and throwing fails every guarded request, including the ones that repair the row.
  - The read is per entry rather than per row, so one bad value does not discard the row's valid denials.
  - An unreadable kill-switch row reads as an empty list, for the same reason.
- `getRbacConfig` caches for 60 seconds. `invalidateRbacCache()` must follow every write to an `rbac.*` key or to `app.sections.disabled`.

### Writes

- **Per-user overrides.** `sectionAccess.set` refuses a section with children for every value, `null` included. It is the only writer of `user_section_access`.
- **Role defaults.** `setRoleDefaults` takes `sectionAccessDefaultsSchema`. The map replaces the stored one, and what it omits keeps the static default. Its last-admin guard counts against `mergeSectionAccessDefaults(input)`, the map the reader will build. It is the only write path for the key, since `config.set` refuses the `rbac` prefix.
- **Kill switch.** Unchanged. `saveSectionsDisabledGuarded` refuses a list that leaves no administrator able to reach user administration.
- **A new section** still requires `sectionEnum`, `SECTION_TO_PERMISSION` and `SECTION_ACCESS_DEFAULTS` to change together.

### API section guards

- `withSectionAccess(section)` accepts only a section without children. It throws when the procedure is built, at module load, so the API does not start with a guard on a parent. It reads only the guarded section's override, and a failed read fails the request.
- `storage.getConfig` and `storage.saveConfig` are guarded by `settings.storage`. No other procedure has a section guard: `Resource:Action` remains the API boundary.
- [ADR-023](023-sensitive-data-outbound-boundary.md) records, among its gaps, that `storage.getConfig` returns decrypted S3 credentials behind `withSectionAccess('settings')`. The guard now names `settings.storage`. The gap it records, no admin-only sub-gate on the decrypted credentials, is unchanged.

### Access dialogs

- `UserAccessDialog` and `ApproveUserDialog` render `SectionAccessList`. It resolves every switch with the core `effectiveSectionAccess` and shows no switch until `sectionAccess.getDefaults` has answered.
- A parent switch, a reset and the "overridden" mark act on the leaves under the section, at any depth, that the kill switch does not cover. A leaf the kill switch covers is shown off and locked; its override and any pending edit are never written, deleted or reset.
- **The rule for saving** (`useSectionOverridesEditor`):
  - The editor holds the overrides from a fresh read, taken at each opening, plus the administrator's edits. Nothing else.
  - A background refetch never changes what it holds.
  - A save sends the edits on editable leaves, each an absolute value. A call that committed but answered with an error is therefore harmless to send again: the field ends with the same value, though an audit row may repeat.
  - Every control is disabled until the save and its reconciliation end, and Escape does not close the dialog meanwhile.
  - After any outcome, a fresh read replaces the state held and drops the edits it already reflects. If that read fails, the dialog refuses further attempts and asks to be closed and reopened.
- **Approval.** An attempt is three steps:
  - the role, sent only when the administrator's choice differs from the stored role, which is read from `users.listPending`;
  - then the override save;
  - then `approvePending`.

  After a failure the dialog re-reads the role, the pending status and the overrides. An account no longer in the pending list ends the dialog, with no second approval. The list excludes approved, rejected and deactivated accounts alike, so the message claims none of them.
- **Not guaranteed:**
  - two administrators editing the same field at once: the last write wins;
  - an edit dropped because it equalled the role default when switched follows a role default changed while the dialog is open.

### Migration of the data written before

Migration `20261001220553_section_access_leaf_overrides` is hand-written SQL, one `DO` block, so the rewrite commits or rolls back as a unit. It does not change the schema.

- **Invariant.** For a user U with role r and every child C of a parent P, after the migration C resolves to **gate(U, P) AND without(U, C)**:
  - **gate** is U's override on P if any, else `legacy(r, P)`: the value of P under ADR-021;
  - **without** is U's override on C if any, else `legacy(r, C)`: what C resolved to before;
  - **`legacy(r, s)`** follows the reader being replaced. If the stored map has the key r, it is the stored `'enabled'` or `'disabled'`, and anything else is the permission fallback. If the map has no key r, or there is no map, it is the static table.

  The permission fallback is this release's, which removed `config:read` from editor and viewer; for the five parents it is unchanged. Sections without a parent and the kill switch are not touched.
- **What it does to user overrides.**
  - A parent override `false` becomes an explicit `false` on every child.
  - A parent override `true` is deleted. Before that, each child the user reached through it, but whose role default the rewritten map closes, gets an explicit `true`.
  - A child `true` under a parent the user's role closes, with no override on the parent, is deleted (owner decision). The user then follows the role, which keeps the group closed as before. The administrator's recorded intent is lost; the pre-deploy backup keeps it.
- **What it does to the stored role map.** The map is rewritten with every section explicit. Valid values are kept, anything else becomes the `'auto'` it was read as, and every child of a parent the role closes becomes `'disabled'`. Unknown roles and sections are dropped, and no role is added. The `isEncrypted` flag is ignored, as the old reader ignored it, and cleared on the rewrite. A row the old reader could not use is deleted.
- **Frozen on purpose.** The hierarchy, the static table and the permission fallback are copied into the file as they stood. Replaying it on an older backup through the migration bridge (`apps/api/src/lib/backup/migrationBridge.ts`) therefore does not depend on later code. A deploy-time TypeScript script would have missed the bridge.
- **Run once.** Through `prisma migrate deploy` or the bridge, which record it. A second run would delete the child grants made since, including the ones it inserted. It cannot tell rows written under ADR-025 from legacy ones; only development databases hold such rows.

## Consequences

- **Upgrading a production instance** to the release that carries the migration (v3.0.0) requires three things:
  - a backup taken right before the deploy, the only record of the overrides the migration rewrites;
  - no v2.1.x API process running while it migrates; Luke is single-instance (ADR-011) and the compose stack recreates the container;
  - nothing else; the migration runs by itself.

  These steps are written into the release's CHANGELOG section by hand at `release:prepare`.
- **Verification.** A one-off exhaustive check against the invariant (81,567 resolutions, no difference) was run when the migration was written. `apps/api/test/sectionAccessLeafMigration.integration.spec.ts` pins one scenario per case with literal expectations.
- **Unchanged for the static table.** The static table already agrees with derived parents (`sectionHierarchy.test.ts`), so a deployment that stores no role map resolves as before.
- **Cost of the guard.** The section guard reads one override row per guarded request instead of the user's whole map.
- **Gaps of earlier records this changes.** These are noted here because accepted records are not edited.
  - [ADR-026](026-resource-action-permissions-enforced.md) lists `RbacConfig.roleToPermissions` as populated but never read: the field is removed.
  - [ADR-018](018-runtime-configuration-and-bootstrap-environment.md) lists `setRbacSectionDefaultsTx` among the writes that bypass registry validation. It still writes without `saveConfig`, but `setRoleDefaults` validates with the same `sectionAccessDefaultsSchema` the registry entry uses.
  - The same record says `getRbacConfig` parses `app.sections.disabled` itself. It still reads the row with Prisma, but parses it with the registry entry.

### Observed gaps

These are still open when this record is accepted. They are not endorsed here.

- **Child sections are not route boundaries in the web.** Only the top-level layouts check a section. The storage settings page is reachable by URL with `settings.storage` off: its form loads nothing and its save is refused.
- **No UI for role defaults.** `setRoleDefaults` is reachable only as tRPC surface.
