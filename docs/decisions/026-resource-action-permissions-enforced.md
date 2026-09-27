# ADR-026 — Resource:Action Permissions: Enforced Coverage, Own-Data Procedures and Admin-Only Operations

## Status

Accepted

## Context

[ADR-016](016-static-resource-action-permissions.md) states the static `Resource:Action` model and its server-side enforcement. Since it was accepted, the gaps it recorded have mostly been closed, and closing them took decisions ADR-016 does not contain:

- Coverage was not mechanically enforced: a WARNING-only semgrep rule looked at mutations, and 45 protected procedures had no `requirePermission`. Thirty-one of them work only on the caller's own data and need no permission; two had a real gap (presigned uploads open to any session).
- Authorization compared role names in several places — the maintenance bypass, the raw and decrypted config values, the unrestricted brand scope, the web helpers — instead of checking a permission.
- A permanent delete of a brand, season or vendor required only `<resource>:delete`, which `editor` holds through `brands:*`, `seasons:*` and `vendors:*`.

This record supersedes ADR-016 and states the decision in force today. ADR-016 remains as the historical record.

## Decision

### Permission model

Unchanged from ADR-016. `packages/core/src/auth/permissions.ts` declares `RESOURCES`, `ACTIONS`, the `Permission` type and `VALID_RESOURCE_ACTIONS`; `ROLE_PERMISSIONS` assigns them to `admin` (`*:*`), `editor` and `viewer`. The map is static and version-controlled; AppConfig `rbac.*` keys affect section visibility only. `hasPermission(user, permission)` evaluates `*:*`, then `resource:*`, then the exact permission, and answers `false` for a role outside `Roles`.

### Server-side enforcement

- Every tRPC procedure on `protectedProcedure` declares its permission with `requirePermission` (single, OR-array, declaration or input resolver), which denies with `FORBIDDEN` and logs the structured `Permission denied` warning.
- **Own-data procedures** use `selfProcedure` instead (`apps/api/src/lib/trpc.ts`): the same middleware as `protectedProcedure`, under a contract — it writes only rows owned by the caller and takes no target user id; its reads are the caller's rows plus what computing the caller's own view needs. `me.changeEmail` and `me.updateProfile` are declared exceptions: both write a unique email, so each reveals whether an address is taken. Nothing verifies a handler keeps the contract; it is a declaration for review.
- **A check `requirePermission` cannot express** — every one of several permissions, as `editLock.acquireMany`/`renew` need — is done in the handler with `can(ctx, permission)`, and the procedure carries `// nosemgrep: luke-procedure-requires-permission -- <why>`. The same annotation marks a procedure open to every signed-in user by design (`feedback.submit`).
- **Coverage is enforced.** `.semgrep/rules/procedure-requires-permission.yml` (ERROR, pre-commit, `security:sast`, `security.yml`) fails any query, mutation or subscription on `protectedProcedure` whose chain has no `.use(requirePermission…)`, and any router that binds `protectedProcedure` to a name. It proves the middleware is present, not that it asks for the right permission.
- `publicProcedure` is for pre-session endpoints. `adminProcedure` checks `maintenance:update` in its middleware — a permission, not a role.
- Raw upload routes (`apps/api/src/routes/`) use `requireSessionWithPermission` with the permission of the procedure that links the file; presigned uploads take theirs from `PRESIGNED_UPLOAD_PERMISSION` (`company-assets` → `company_profile:update`).

### Admin-only operations

An operation reserved to administrators on a resource another role holds through `resource:*` requires `*:*`: `requirePermission('*:*')` on the server, `can('*:*')` in the web. A new action on that resource is not a substitute, because the wildcard grant covers actions added later. Where no other role holds the resource at all, a permission only `admin` holds is enough — `pricing:update`, `config:update`, `maintenance:update`. `*:*` applies today to:

- the permanent delete of brands, seasons and vendors (`hardDelete`); the resource's `:delete` archives;
- the unrestricted brand and function scope (`context.service.ts`), which everyone else gets through team membership.

### Permissions, not role names

Authorization reads a permission, never a role name:

- the maintenance bypass is `maintenance:update` (`bypassesMaintenance`, shared by the tRPC guard, the login flow and the force-logout that revokes the sessions it would block; the web `MaintenanceGate` mirrors it);
- showing a config value raw or decrypted takes `config:update` — the sub-gate [ADR-023](023-sensitive-data-outbound-boundary.md) describes as an inline role check;
- the web permission hooks expose no role helper (`usePermission`: `can`, `canAll`, `canAny`).

Comparisons of **another** user's role are data rules, not authorization, and this record does not govern them: protecting the last administrator, refusing a section override on an administrator, expanding a calendar audience. Validating a role name against `Roles` (the LDAP role mapping) is input validation.

### Governed UI patterns

Unchanged from ADR-016: creation controls use `CreateActionButton`; table actions use `PermissionButton`, or `PermissionTooltip` when the control is not a `Button`; a missing permission leaves the control visible, disabled and explained. The server check remains authoritative.

### Separate layers

Section visibility ([ADR-025](025-section-access-resolution-derived-parents.md)) and brand scope are additional layers stacked after the permission check, never replacing it.

## Consequences

- A new protected procedure without a permission fails the build, so each one is a decision: a permission, `selfProcedure`, or a reasoned `nosemgrep`.
- Adding a resource or action still means updating `RESOURCES`/`ACTIONS`, `VALID_RESOURCE_ACTIONS` and `ROLE_PERMISSIONS` together, and a `resource:*` grant still covers actions added later — which is why admin-only operations use `*:*`.
- Permissions follow the role carried by the session; a role change reaches existing sessions through session revocation.

### Observed gaps

Recorded as follow-ups; this record does not endorse them.

- Only `requirePermission` logs the structured denial warning. `adminProcedure`, `withSectionAccess`, `requireSessionWithPermission`, the edit-lock check and the config raw/decrypt check deny without it.
- `maintenance:mode_manage` is declared in `VALID_RESOURCE_ACTIONS` and required nowhere.
- Comments have drifted from the model: the `hasPermission` documentation lists an ABAC `context` parameter; the `requirePermission` example passes a `context` field `PermissionDeclaration` does not have; in `apps/api/src/lib/permissions.ts` the file header mentions legacy roles and the `requirePermission` documentation mentions user-granted permissions; `RbacConfig.roleToPermissions` in `packages/core/src/server/rbacConfig.ts` is populated but never read.
- `me.updateProfile` does not handle a unique-email conflict: a taken address fails as an internal error.
- Brand scope has no decision record of its own.
