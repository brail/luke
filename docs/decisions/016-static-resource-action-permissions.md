# ADR-016 — Static Resource:Action Permissions and Server-Side Enforcement

## Status

Accepted

## Context

[ADR-006](006-resource-action-permissions.md) introduced the `Resource:Action` permission model. That core is still how Luke authorizes operations, but most of what ADR-006 described around it no longer holds. The `useAccess` hook, the `AccessGate` and `AccessAll` components and the `adminOrEditorProcedure` compatibility alias were removed (`69170a2`); the migration phases it tracked are finished; its resource list, action list and logging shape have changed; and the editor and viewer roles no longer hold any configuration permission (`780660c`).

This record supersedes ADR-006 and states the decision in force today. ADR-006 remains, translated, as the historical record of the original decision.

Two neighbouring mechanisms are related but are not decided here: section visibility, governed by [ADR-010](010-section-access-precedence.md), and brand scope, which limits data to the brands a user's teams cover.

## Decision

Authorization is a static map from role to `Resource:Action` permissions, evaluated in code and enforced on the server.

### Permission model

- `packages/core/src/auth/permissions.ts` declares the vocabulary: `RESOURCES`, `ACTIONS`, the `Permission` type (`` `${Resource}:${Action}` `` or `'*:*'`) and `VALID_RESOURCE_ACTIONS`, which limits the actions each resource accepts.
- `ROLE_PERMISSIONS` assigns permissions to the three roles. `admin` holds `*:*`. `editor` and `viewer` hold explicit grants; the only resource wildcards are `editor`'s `brands:*`, `seasons:*` and `vendors:*`.
- The map is static and version-controlled. Permissions are not configurable at runtime: AppConfig `rbac.*` keys affect section visibility only.
- Configuration permissions (`config:*`) are held by `admin` alone. Almost none of the endpoints they gate also check section visibility — only `storage.getConfig` and `storage.saveConfig` do — so a grant to another role would reach further than the hidden settings pages suggest.
- `hasPermission(user, permission)` evaluates `*:*`, then `resource:*`, then the exact permission. `expandRole` expands wildcards into the valid actions of each resource.

### Server-side enforcement

- Protected tRPC procedures declare their required permission with `requirePermission` from `apps/api/src/lib/permissions.ts`. It accepts a single permission; an array, satisfied by any one of its members; a `PermissionDeclaration`; or a resolver that derives the permission from the parsed input, placed after `.input()`. An administrator-only operation may require `'*:*'`.
- A denial from `requirePermission` raises `FORBIDDEN` and logs a structured `Permission denied` warning carrying the trace id, user id, role, and the requested and denied permissions. Results are cached for the duration of the request.
- Rules inside a procedure use the same model without throwing: `can(ctx, permission)` for conditional logic and for requirements `requirePermission` cannot express, such as holding every permission in a set; `hasPermission` against the session user for field-level restrictions.
- Code outside tRPC middleware uses `hasPermission` directly: `requireSessionWithPermission` in `apps/api/src/lib/auth.ts` for raw Fastify routes, and the per-bucket upload rule in `apps/api/src/plugins/storageUpload.ts`.
- `adminProcedure` in `apps/api/src/lib/trpc.ts` checks the `maintenance:update` permission. Only `admin` holds that permission today, through `*:*`, but the procedure checks a permission, not a role.

### Governed UI patterns

For the two patterns `CLAUDE.md` governs, a missing permission leaves the control visible, disabled, and explained by a tooltip:

- creation controls use `CreateActionButton`;
- table Edit and Delete actions use `PermissionButton`, or `PermissionTooltip` when the control is not a `Button`.

The disabled control remains reachable by keyboard so its tooltip can be read. Client components read permissions through `usePermission` (`can`, `canAll`, `canAny`); client checks shape the interface, and the server check remains authoritative. This record sets no rule for other frontend controls.

### Separate layers

Section visibility (ADR-010) is an additional layer: `withSectionAccess` can be stacked after `requirePermission`, but it never replaces the permission check. Brand scope is enforced by `apps/api/src/services/brandScope.service.ts` and the blocking semgrep rule `.semgrep/rules/brand-scope-required.yml`. Neither mechanism is decided by this record.

## Consequences

- Adding a resource or action means updating `RESOURCES` or `ACTIONS`, `VALID_RESOURCE_ACTIONS` and `ROLE_PERMISSIONS` in the same change. A new grant is a reviewed code change, never a runtime setting.
- A `resource:*` grant also covers actions added to that resource later: a new action on `brands`, `seasons` or `vendors` reaches `editor` without any change to `ROLE_PERMISSIONS`.
- Permissions follow the role carried by the session, so a role change reaches existing sessions only through session revocation, which `users.update` triggers when a role changes.
- The per-request cache removes repeated evaluations within one request; it does not reduce work across requests.

### Observed gaps

These are recorded as follow-ups. This record does not endorse them.

- Some authorization paths compare role strings instead of checking a permission, contrary to `CLAUDE.md`: decrypt and raw-value reads in `apps/api/src/routers/config.ts`; the owner-or-admin/editor rule in `getMetadata` and `getDownloadLink` in `apps/api/src/routers/storage.ts`; the unrestricted brand and function scope granted to `admin` in `apps/api/src/services/context.service.ts`; and the maintenance-mode bypass for `admin` in `apps/api/src/lib/maintenanceMode.ts` and the login flow in `apps/api/src/services/auth.service.ts`. On the web, `useBrandPermissions` derives `isAdmin`, `isAdminOrEditor` and hard-delete rights from the role.
- Coverage is not mechanically enforced. `.semgrep/rules/mutation-requires-permission.yml` runs as a non-blocking `WARNING`, and a protected procedure without `requirePermission` is not detected.
- Only `requirePermission` logs the structured denial warning. `adminProcedure`, `withSectionAccess`, `requireSessionWithPermission`, the per-bucket upload rule, the edit-lock permission check and the inline role comparisons deny without it.
- Comments have drifted from the model: the `hasPermission` documentation still lists an ABAC `context` parameter; the `requirePermission` example passes a `context` field that `PermissionDeclaration` does not have; the header of `apps/api/src/lib/permissions.ts` mentions compatibility with legacy roles, and the `requirePermission` documentation mentions user-granted permissions; the upload plugin comment says the `exports` bucket needs `config:read` "(editor and admin)", although `editor` no longer holds it; and `RbacConfig.roleToPermissions` in `packages/core/src/server/rbacConfig.ts` is populated but never read.
- Brand scope has no decision record.

### Scope

Comparisons of another user's role — detecting a role change, protecting the last administrator, expanding a calendar audience — are data rules, not authorization checks, and this record does not govern them.
