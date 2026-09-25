# ADR-025 — Section Access Resolution: Derived Parents over a Static Base

## Status

Accepted

## Context

[ADR-021](021-section-access-static-base-and-overrides.md) resolves section visibility through four layers:
- a global kill switch;
- a per-user override;
- a per-role default, built from the static `SECTION_ACCESS_DEFAULTS` table with AppConfig's `rbac.sectionAccessDefaults` merged over it;
- a permission fallback.

It applies those layers to every section independently. That resolution order still stands for sections without children, and this record restates it below. What changes is the semantics of parent sections.

Section names use dot notation: `admin.brands` is nested under `admin`. The web app checks only the top level of a route. `apps/web/src/app/(app)/admin/layout.tsx` calls `assertSectionAccess('admin')`, and no page checks its own child section. The menu (`apps/web/src/hooks/useMenuAccess.ts`) shows a child only when parent and child are both on. A child is therefore usable only together with its parent.

Under ADR-021 nothing tied a parent to its children. A configuration could hold a child on with its parent off: an administrator enabled `admin.brands` for a viewer, the override was stored, and the viewer was still sent away from `/admin`. The opposite state, a parent on with every child off, opened an empty area.

The owner's rule is that **a parent section is on if and only if at least one of its children is on**, for every section that has children, and that no configuration may break it.

This record supersedes ADR-021: it restates the resolution order that survives, and replaces the semantics of parent sections.

Enforcing the rule on each write was examined and rejected. A section's effective state comes from several independently written sources:
- the user's overrides;
- the role defaults, static plus AppConfig;
- the kill switch;
- the user's role;
- `config.delete`.

Concurrent writes add more ways to break it. Each review of that design found another path around it.

## Decision

The guarantees below describe resolution when `rbac.sectionAccessDefaults` is absent, or was written through the supported paths. The reader parses a stored row without validating either its shape or its values, so a row written directly to the database is outside them (Observed gaps).

### The hierarchy is derived, not listed

`packages/core/src/rbac/sectionHierarchy.ts` derives the tree from the dot notation of `sectionEnum`, through `parentSectionOf`, `childSectionsOf` and `ancestorSectionsOf`. The rule applies to every section with children, including sections added later: adding `x.y` to the enum makes it a child of `x`.

### A parent is resolved from its children

`effectiveSectionAccess` in `packages/core/src/rbac/effectiveAccess.ts` takes the user's whole override map (`userOverrides`), because a parent needs its children's overrides.

- **A section with children** is accessible if and only if at least one of its children is. Its own override, role default and permission fallback are not consulted.
- **A section without children** goes through the four layers below.
- The rule therefore holds **by construction**, whatever is stored and whichever writer stored it.

### A section without children: four layers

- **Layer 0, the kill switch** (`app.sections.disabled`), denies when the section, or any section it is nested under, is listed. Disabling a parent therefore disables its whole group.
- **Layer 1, the per-user override**, decides when present; its absence delegates to the next layer rather than denying.
- **Layer 2** is the static table, overridden per role by AppConfig.
  - `getRbacConfig` in `packages/core/src/server/rbacConfig.ts` builds the base from `SECTION_ACCESS_DEFAULTS`, mapping each boolean to `'enabled'` or `'disabled'`, and merges a stored `rbac.sectionAccessDefaults` row over it.
  - `SECTION_ACCESS_DEFAULTS` is typed `Record<Role, Record<Section, boolean>>`, so every role covers every section and the base never contains `'auto'`.
  - For a known role with no override for a section, the static value decides.
- **Layer 3, the permission fallback** (`SECTION_TO_PERMISSION` and `hasPermission`), is reached only by an explicit `'auto'` or by a role outside `Roles`.
  - An explicit `'auto'` is the supported way to route a section back to the permission model.
  - An unrecognised role has no entry in any map the supported write paths can produce, and `hasPermission` grants it nothing, so its section is denied.

### Writes

- **Per-user overrides.** `sectionAccess.set` refuses `true` and `false` on a parent section, because the value would be ignored. It still accepts `null`, so an override stored before this decision can be removed.
- **Role defaults.** They keep their parent entries: those entries are accepted but no longer govern access.
  - The per-role merge replaces a role's map wholesale, so it is safe only because the write schema is exhaustive. `setRoleDefaults` takes `z.record(z.enum(Roles), z.record(sectionEnum, …))`, which Zod 4 treats as exhaustive, and `config.set` cannot write `rbac.*`.
  - A change to either of those reopens the question.
- **Kill switch.** Its guard (`saveSectionsDisabledGuarded` in `apps/api/src/lib/configManager.ts`) asks whether the proposed list leaves no admin able to reach user administration, using the same recovery count as the other last-admin guards. It always takes the last-admin lock and reads the configuration without the cache. Disabling every `settings.*` child, or `settings.users` alone, is refused.
- **Cache.** `invalidateRbacCache()` must still follow every write to an `rbac.*` key.
- **New sections.** A new section still requires `sectionEnum`, `SECTION_TO_PERMISSION` and `SECTION_ACCESS_DEFAULTS` to be updated together. Parent entries in the last two are kept for exhaustiveness.

### Enforcement and UI use the one resolver

- `withSectionAccess` (`apps/api/src/lib/sectionAccessMiddleware.ts`) delegates the whole resolution to the core.
- `UserAccessDialog` and `ApproveUserDialog` render one shared list (`SectionAccessList`, backed by `apps/web/src/lib/sectionTree.ts`):
  - a parent switch shows its children's state;
  - switching a parent switches every child;
  - only leaf overrides are produced.

## Consequences

- The version-controlled table is what a fresh instance obeys. AppConfig changes that only where an administrator has written a role map.
- The static defaults already agreed with derived parents for every role, so their resolution is unchanged. `packages/core/src/rbac/__tests__/sectionHierarchy.test.ts` pins that, and pins the rule over every combination of child overrides, parent overrides and kill switch.
- Adding a section to `sectionEnum` without adding it to `SECTION_ACCESS_DEFAULTS` is a compile error, not a silent deferral to permissions.
- `invalidateRbacCache()` is load-bearing: `getRbacConfig` caches the merged result for 60 seconds.
- The admin-recovery predicate (`settings` and `settings.users`) is unchanged in shape. An effective `settings.users` now implies an effective `settings`.
- The menu's `parent && child` check is now redundant but still correct.
- **Deploy check.** Stored state that set a parent independently of its children resolves differently now, so check it at deploy:
  - A **user override on a parent section** (`UserSectionAccess` rows on `settings`, `maintenance`, `product`, `admin` or `sales`) is now inert. Such rows can exist, because the dialogs used to offer a switch for every section. A stored parent `false` over enabled children **widens** access, since the group comes back. A stored parent `true` over children that are all off **narrows** it.
  - A **per-role map in AppConfig** whose parent value disagreed with its children now follows the children, in either direction.
  - A **kill-switch list** that named every child of a parent but not the parent now turns the parent off as well.

### Observed gaps

These deviations exist when this record is accepted. They are recorded as follow-ups; this record does not endorse them.

- **Child sections are not route boundaries.** Only the top-level layouts check a section. A user who can open a parent can reach every child page by URL, within what the API's `Resource:Action` checks allow. Whether child sections should be enforced per page is an open question, not decided here.
- **No UI for role defaults.** `setRoleDefaults` has no caller in `apps/web`: it is reachable only as tRPC surface. That says nothing about what a deployment may already have stored.
- **Stored rows are not validated on read.** The read path parses the stored row with a bare `JSON.parse` and validates neither its shape nor its values.
  - An unparseable row is discarded and the static base retained.
  - In a row that does parse, missing or invalid entries fall through to the permission fallback, which can grant a section the static table denies.
  - Such a row can also introduce an unrecognised role, whose `'enabled'` sections decide at layer 2 without ever reaching the fallback.
  - The supported write paths reject all of these, and the parseable invalid-row cases are not covered by tests.
