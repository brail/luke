# ADR-029 — Resource:Action Permissions: One Protected Builder, Admin-Only Operations and Logged Refusals

## Status

Accepted

## Context

[ADR-026](026-resource-action-permissions-enforced.md) made permission coverage mechanical and recorded the gaps that remained. Closing them took decisions it does not contain:

- `adminProcedure` was a second authenticated builder. It checked `maintenance:update` and skipped the maintenance guard. It gated the maintenance-mode mutations, section-access management and the admin-sent verification email. The web showed the last two on `users:update`, so an `editor` managing users met `FORBIDDEN` from a control it was offered. Meanwhile `maintenance:mode_manage`, the permission named for maintenance mode, was required nowhere.
- Only `requirePermission` logged a refusal. `adminProcedure`, `withSectionAccess`, the raw-route permission check and the manual checks refused without a trace, so a 403 could not be traced to the permission or section behind it.
- `me.updateProfile` also wrote the email, a second way into a unique column. ADR-026 declared that an exception to the own-data contract, and listed its unhandled conflict as a gap.

This record supersedes ADR-026 and states the decision in force today. ADR-026 remains as the historical record.

## Decision

### Permission model

Unchanged. `packages/core/src/auth/permissions.ts` declares `RESOURCES`, `ACTIONS`, the `Permission` type and `VALID_RESOURCE_ACTIONS`, and `ROLE_PERMISSIONS` assigns them to `admin` (`*:*`), `editor` and `viewer`. The map is static and version-controlled; AppConfig `rbac.*` keys affect section visibility only. `hasPermission(user, permission)` evaluates `*:*`, then `resource:*`, then the exact permission. It answers `false` for a role outside `Roles`.

### Server-side enforcement

- **There is one authenticated builder with a permission, `protectedProcedure`.** Every procedure on it declares its permission with `requirePermission`: a single permission, an OR-array, a declaration or an input resolver. `adminProcedure` is gone. A procedure that needs an administrator says which permission makes one (below), and it passes the maintenance guard like every other.
- **Own-data procedures** use `selfProcedure` (`apps/api/src/lib/trpc.ts`), under a contract: it writes only rows owned by the caller and takes no target user id. Its reads are the caller's rows plus what computing the caller's own view needs. The one declared exception is `me.changeEmail`, which writes a unique email and so reveals whether an address is taken. `me.updateProfile` no longer writes the email. Nothing verifies that a handler keeps the contract; it is a declaration for review.
- **A check `requirePermission` cannot express** is made in the handler with `can()` or `hasPermission()`. These are:
  - the AND of `editLock.acquireMany` and `renew`, which carries `// nosemgrep: luke-procedure-requires-permission -- <why>`;
  - the `config:update` needed to read a config value raw or decrypted;
  - the `*:*` that `users.update` needs for a password, a privileged field or a role.

  The `nosemgrep` annotation also marks a procedure open to every signed-in user by design (`feedback.submit`).
- **Coverage is enforced.** `.semgrep/rules/procedure-requires-permission.yml` (ERROR) fails any query, mutation or subscription on `protectedProcedure` whose chain has no `.use(requirePermission…)`. It also fails any router that binds the builder to a name. It proves the middleware is present, not that it asks for the right permission.
- `publicProcedure` is for pre-session endpoints. Raw routes (`apps/api/src/routes/`) use `requireSessionWithPermission` with the permission of the procedure that links the file. Presigned uploads take theirs from `PRESIGNED_UPLOAD_PERMISSION`.

### Every permission or section refusal is logged the same way

Every refusal of a Resource:Action permission or a section writes one `Permission denied` warning through `logAccessDenied` (`apps/api/src/lib/permissions.ts`). This covers `requirePermission`, a manual check, `withSectionAccess`, and `requireSessionWithPermission` on the route's own request logger. The warning carries `traceId`, `userId` and `userRole`, plus either `requestedPermissions`/`deniedPermissions` or `section`.

The message the client gets stays short and names no permission, because a 4xx reaches every client. Brand scope, ownership, self-protection and data rules (the last administrator) are other refusals and do not write this line.

### Admin-only operations

An operation reserved to administrators requires `*:*` (`requirePermission('*:*')` on the server, `can('*:*')` in the web) when another role holds the resource through `resource:*`, or when it acts on authorization itself. A new action on a resource that has a wildcard grant is no substitute, because that grant covers actions added later. `*:*` applies today to:

- the permanent delete of brands, seasons and vendors (`hardDelete`); the resource's `:delete` archives;
- the unrestricted brand and function scope (`context.service.ts`), which everyone else gets through team membership;
- forcing and revoking local access, and, within `users.update`, a password reset, a privileged field or a role;
- section-access management: `sectionAccess.getByUser`, `set` and `setRoleDefaults`.

Where no other role holds the resource, a permission only `admin` holds is enough: `pricing:update`, `config:update`, and the two maintenance permissions below.

### Maintenance

- **Bypassing maintenance** is `maintenance:update` (`bypassesMaintenance`). The tRPC guard, the login flow and the force-logout share it, and the web `MaintenanceGate` mirrors it.
- **Changing the mode** is `maintenance:mode_manage`. That covers `maintenance.mode.schedule`, `activateNow`, `cancelScheduled` and `end` on `protectedProcedure`. While maintenance is active the guard answers first, so only whoever also bypasses it reaches these mutations. Today both permissions are `admin`'s alone. A role given `mode_manage` without `maintenance:update` could schedule maintenance but not end it once active.

### Users

`users:update` may send a user the verification email (`auth.requestEmailVerificationAdmin`). This deliberately includes `editor`: the call mails the address the account already has, changes nothing on it and returns no token. Approving a pending account takes `users:update`. Without `*:*` the approval keeps the account's role and section overrides: the web shows the role read-only, does not read the overrides, and edits neither.

### Permissions, not role names

Authorization reads a permission, never a role name. The web permission hooks expose no role helper (`usePermission`: `can`, `canAll`, `canAny`). Comparisons of another user's role are data rules, not authorization, and this record does not govern them: protecting the last administrator, refusing a section override on an administrator, expanding a calendar audience. Validating a role name against `Roles` is input validation.

### Governed UI patterns and separate layers

Unchanged:

- Creation controls use `CreateActionButton`. Table actions use `PermissionButton`, or `PermissionTooltip` when the control is not a `Button`.
- The server check remains authoritative.
- Section visibility ([ADR-025](025-section-access-resolution-derived-parents.md), [ADR-027](027-section-access-leaf-overrides-and-validated-defaults.md)) and brand scope are additional layers stacked after the permission check, never replacing it.

## Consequences

- A new protected procedure without a permission fails the build. Each one is therefore a decision: a permission, `selfProcedure`, or a reasoned `nosemgrep`. An administrator-only procedure is no longer a choice of builder, so it cannot skip the maintenance guard by accident.
- A 403 for a missing permission or section can be traced from the log. A refusal outside that perimeter still cannot. That covers brand scope, ownership, data rules, and a raw route refusing for a reason other than a permission (the upload bucket allowlist).
- Adding a resource or action still means updating `RESOURCES`/`ACTIONS`, `VALID_RESOURCE_ACTIONS` and `ROLE_PERMISSIONS` together. A `resource:*` grant still covers actions added later.
- Permissions follow the role carried by the session. A role change reaches existing sessions through session revocation.

### Observed gaps

Recorded as follow-ups; this record does not endorse them.

- Brand scope has no decision record of its own.
- The rule that every permission refusal logs is kept by convention for a manual check. No rule fails a `FORBIDDEN` thrown after `can()` or `hasPermission()` without `logAccessDenied`.

## Errata

Appended under [ADR-030](030-documentation-architecture-canonical-language-and-historical-records.md); the sections above are unchanged.

- **2026-10-05 — The section-visibility layer cites ADR-025.** ADR-025 was superseded by [ADR-027](027-section-access-leaf-overrides-and-validated-defaults.md) before this record was accepted; ADR-027 is the current record for that layer and keeps the hierarchy ADR-025 described.
- **2026-10-05 — Decision, the web permission hooks.** `usePermission` exposes `can`, `isAuthenticated` and the `session`: `canAll` and `canAny`, which nothing called, were removed in the commit that adds this entry. It still has no role helper.
