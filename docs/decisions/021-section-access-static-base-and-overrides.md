# ADR-021 — Section Access Resolution: Static Base and Runtime Overrides

## Status

Superseded by [025 — Section Access Resolution: Derived Parents over a Static Base](025-section-access-resolution-derived-parents.md)

## Context

[ADR-010](010-section-access-precedence.md) recorded four precedence layers for section visibility, and that structure still stands: a global kill switch, a per-user override, a per-role default, and a permission fallback. Its account of where the per-role default comes from does not.

ADR-010 sources layer 2 from `AppConfig rbac.sectionAccessDefaults` alone, and its Context states that in the absence of an override the system converges on a value derived from `RBAC Resource:Action`. That described the behaviour at the time, and that behaviour was a defect: the key is never seeded, so with no stored row every section resolved to `'auto'` and deferred to the permission fallback, leaving the version-controlled `SECTION_ACCESS_DEFAULTS` table out of the evaluation entirely. `packages/core/src/server/rbacConfig.ts` records the consequence — 32 measured divergences between the table and actual behaviour, with a viewer seeing `settings.ldap`, `admin.brands` and `sales`.

The fix made the static table the base and AppConfig the override. An Accepted record that still presents the pre-fix behaviour as the design invites a regression back to it, so this record supersedes ADR-010 and states the resolution order in force.

## Decision

The guarantees below describe resolution when `rbac.sectionAccessDefaults` is absent, or was written through the supported paths. The reader parses a stored row without validating either its shape or its values, so a row written directly to the database is outside them; what such a row can do is recorded under Observed gaps.

### Layer 2 is the static table, overridden per role by AppConfig

- `getRbacConfig` in `packages/core/src/server/rbacConfig.ts` builds `STATIC_SECTION_DEFAULTS` from `SECTION_ACCESS_DEFAULTS`, mapping each boolean to `'enabled'` or `'disabled'`, and uses it as the base. A stored `rbac.sectionAccessDefaults` row is merged over it.
- `SECTION_ACCESS_DEFAULTS` is typed `Record<Role, Record<Section, boolean>>` rather than `Partial`, so every role covers every section and `tsc` refuses an omission. The base therefore never contains `'auto'`.
- **For a known role with no override for a section, the static value decides.** The permission fallback is not reached on that path.

### The fallback is reached by an explicit `'auto'`, or by an unrecognised role

- `effectiveSectionAccess` in `packages/core/src/rbac/effectiveAccess.ts` short-circuits only on `'disabled'` and `'enabled'`. An absent entry is coerced to `'auto'`, and `'auto'` falls through to `SECTION_TO_PERMISSION` and `hasPermission`.
- An administrator can therefore route a section back to the permission model by storing `'auto'` for it. That is the supported way to reach layer 3, and the only one on an instance whose roles are known.
- A role string outside `Roles` has no entry in any map the supported write paths can produce, so it resolves through the same fallback, where `hasPermission` grants an unknown role nothing and the section is denied.
- Both paths are pinned by `apps/api/test/sectionAccess.spec.ts`; the no-row and malformed-row paths by `apps/api/test/sectionAccess.integration.spec.ts`.

### The per-role merge is safe only because the write schema is exhaustive

The merge replaces a role's map wholesale rather than merging section by section, so a stored role map that omitted a section would silently send that section to the fallback. `setRoleDefaults` cannot write one: its input is `z.record(z.enum(Roles), z.record(sectionEnum, …))`, and a record keyed by an enum is exhaustive in Zod 4, so a partial map is rejected before it reaches the store. `config.set` cannot write the key either, because `rbac` is not among its allowed prefixes. The per-role merge is sound for as long as both of those hold; a change to either reopens the question.

### Carried over from ADR-010 unchanged

Layer 0 (the kill switch) and layer 1 (the per-user override, where absence delegates to the next layer rather than denying) are as ADR-010 describes. A new section still requires `sectionEnum`, `SECTION_TO_PERMISSION` and `SECTION_ACCESS_DEFAULTS` to be updated together, and `invalidateRbacCache()` must still follow every write to an `rbac.*` key.

## Consequences

- The version-controlled table is what a fresh instance obeys. AppConfig changes that only where an administrator has written a role map.
- Because the static base is complete, adding a section to `sectionEnum` without adding it to `SECTION_ACCESS_DEFAULTS` is a compile error rather than a silent deferral to permissions.
- `invalidateRbacCache()` remains load-bearing: `getRbacConfig` caches the merged result for 60 seconds.

### Observed gaps

These deviations exist when this record is accepted. They are recorded as follow-ups; this record does not endorse them.

- `setRoleDefaults` has no caller in `apps/web`, so there is no current UI path to the per-role override; it is reachable only as tRPC surface. That says nothing about what a given deployment may already have stored.
- The read path parses the stored row with a bare `JSON.parse` and validates neither its shape nor its values, so a row written directly to the database is not bound by the guarantees above. An unparseable row is discarded and the static base retained, which is not necessarily more restrictive than the override it replaces. In a row that does parse, entries that are present and valid decide normally, while missing or invalid ones fall through to the permission fallback, which can grant a section the static table denies; such a row can equally introduce an unrecognised role whose `'enabled'` sections decide at layer 2 and never reach the fallback. The supported write paths reject all of these — `setRoleDefaultsInput`'s enum, and `config.set`'s prefix check — and the parseable invalid-row cases are not covered by tests.
