# ADR-038 — Resource:Action Permissions: Role Grants Follow Default Section Visibility

## Status

Accepted

## Context

[ADR-029](029-resource-action-permissions-one-builder-logged-refusals.md) was the record of the Resource:Action permission model. Resource permissions (`ROLE_PERMISSIONS`, `packages/core/src/auth/permissions.ts`) and section visibility (`SECTION_ACCESS_DEFAULTS` and `SECTION_TO_PERMISSION`, `packages/core/src/schemas/rbac.ts`) are two layers that must stay in sync. On four resources they did not, and RBAC was the permissive one:

- `editor` held `brands:*`, `seasons:*` and `vendors:*`, while `admin.brands`, `admin.seasons` and `admin.vendors` are hidden to it by default. It could create, edit and archive master data, and upload brand logos, through endpoints whose pages it never sees.
- `editor` held `users:update`, while `settings.users` is hidden to it by default. It could update other accounts within the fields `users.update` allows without `*:*`, approve pending accounts, force or clear an email verification, revoke sessions and send the verification email. ADR-029 §Users had decided the last of these for `editor` on purpose.

A census of every procedure called only from pages hidden to a role found the same gap inside two resources `editor` needs for its own pages. `collection_layout:update`, which the product collection layout uses, also opened the collection catalog configured on `admin/collection-layout-configuration`; `season_calendar:update`, which the planning calendar uses, also opened the vendor closures configured in the vendor dialog of `admin/vendors`. A rule that groups sections by resource cannot see this: the resource has a visible leaf.

The editor's and viewer's `config` grants had been removed earlier for the same disagreement, and two visible pages had kept reading through them: the planning calendar's holidays (`holidays.listHolidays`, `config:read`) and the statistics page's next-sync label (`integrations.nav.sync.getFilter`, `config:read`). Both were refused and showed nothing, without an error. Separately, the manual order-portfolio and KIMO syncs (`sales.statistics.portafoglio.triggerSync`, `sales.statistics.kimo.triggerSync`) start a NAV replica but required `sales:read`, so any role reading sales statistics, `viewer` included, could start one.

The owner reviewed every grant of `editor` against its default sections and chose to remove the write grants on brands, seasons, vendors and users (#81), rather than show those sections to `editor`. Superseding only ADR-029 §Users was not an option: the status vocabulary has no partial supersession ([ADR-030](030-documentation-architecture-canonical-language-and-historical-records.md)).

## Decision

This record supersedes ADR-029 as a whole. Its decisions, read with its errata, stand unchanged except where this section says otherwise.

### The invariant

For resources mapped to leaf sections through `SECTION_TO_PERMISSION`, every role holding a mutating permission on such a resource has at least one of its mapped leaves visible in `SECTION_ACCESS_DEFAULTS`, and every default-visible leaf has its mapped permission granted. A permission is mutating unless its action is `read`, `read_all`, `view_revisions` or `export`. `packages/core/src/rbac/__tests__/sectionHierarchy.test.ts` enforces this static invariant over every role. Runtime section overrides (`rbac.sectionAccessDefaults`, per-user overrides) change visibility only and never grant a resource permission.

A resource no leaf maps to (`settings`, `company_function`, `company_team`) is outside the invariant. The invariant works per resource; that a procedure serves only hidden pages is a property kept by census and review, not by this test.

### Grants

- `editor` holds `brands:read`, `seasons:read` and `vendors:read` instead of the three wildcards, and no longer holds `users:update`.

### Users

This replaces ADR-029 §Users. User management is admin-only in effect: `users.update`, `users.approvePending`, `users.forceVerifyEmail`, `users.revokeUserSessions` and `auth.requestEmailVerificationAdmin` keep requiring `users:update`, which only `admin` holds, through `*:*`. The `*:*` guards inside `users.update` and the `USER_EDITOR_UPDATABLE_FIELDS` allowlist stay, as the default for any future role granted `users:update` without `*:*`. So does ADR-029's approval path for such a role: approving a pending account without `*:*` keeps the account's role and section overrides, and the web shows the role read-only and neither reads nor edits the overrides.

### Admin-only operations

ADR-029 requires `*:*` for an administrator-only operation when another role holds the resource through `resource:*`. No role holds `brands:*`, `seasons:*` or `vendors:*` any more; the permanent delete of brands, seasons and vendors keeps requiring `*:*` all the same.

Where no other role holds a resource through a wildcard, an action only `admin` holds is enough, as ADR-029 already allowed:

- **Starting a NAV replica sync.** `sales` gains the action `sync`. The two manual triggers require `sales:sync`; reading the replica's sync state (`getSyncState`) stays `sales:read`. The web gates the sync buttons on `sales:sync` and the state query on `sales:read`.
- **Configuration on admin pages.** `collection_layout` and `season_calendar` gain the action `configure`. The collection catalog writes (`collectionCatalog.create`, `update`, `remove`, `restore`, `reorder`) require `collection_layout:configure`, and the vendor closure writes (`holidays.upsertVendorClosure`, `deleteVendorClosure`, `confirmVendorClosures`, `prefillVendorClosures`) require `season_calendar:configure`. `admin.collection_layout_configuration` maps to `collection_layout:configure`, so the `auto` fallback shows it only to who can use it. `collectionCatalog.listAll` is a read and requires `collection_layout:read`, as CLAUDE.md asks of a read-only query; `phase.listAll` keeps requiring `phase_catalog:update` by its earlier decision.

### Reads a visible page needs

A procedure a default-visible page reads requires a permission that page's roles hold, never `config:*`:

- `holidays.listHolidays` requires `season_calendar:read`, like `holidays.listCountries`; importing and deleting holidays stay `config:update`.
- Both `getSyncState` return the replica's schedule (`autoSyncEnabled`, `intervalMinutes`) for the statistics page; `integrations.nav.sync.getFilter`, which returns the whole NAV sync filter, stays `config:read`.

The `sales.statistics.*.download` mutations stay `sales:read`, although the statistics section is hidden to `viewer` by default: they produce an export of what the role may read, not a configuration.

## Consequences

- Editors can no longer create, edit or archive brands, seasons and vendors, upload brand logos, manage users, or configure the collection catalog and vendor closures. Only admins can start a manual order-portfolio or KIMO sync. Editors and viewers see the holidays on the planning calendar and the next automatic sync on the statistics page again. Role permissions are not among the supported compatibility contracts [ADR-033](033-release-identity-versioning-contract-and-release-trains.md) lists, so this ships as a fix, with a release note for editors.
- A grant or a section default that breaks the invariant fails the core test suite. Widening what a role writes is a decision on both layers at once.
- No built-in role holds `users:update` without `*:*`, so the guards that refuse such a caller are tested in two ways: an admin whose `can` is narrowed to refuse `*:*` (`users.integration.spec.ts`, `accessDeniedLogging.integration.spec.ts`), and, for a guard that is a `requirePermission('*:*')` middleware (forcing or revoking local access, the permanent deletes), the refused permission granted to `editor` for one test (`grantEditor`, `apps/api/test/helpers.ts`, which checks the grant took effect).
- No built-in role holds a `resource:*` grant any more; the resource-wildcard branch of `hasPermission` and `expandRole` is tested with a temporary grant.
- References to ADR-029 for its unchanged decisions remain valid; ADR-029 stays as the historical record.

### Observed gaps

ADR-029's observed gaps are this record's. Recorded as follow-ups; this record does not endorse them. Open at acceptance:

- Brand scope has no decision record of its own.
- The rule that every permission refusal logs is kept by convention for a manual check. No rule fails a `FORBIDDEN` thrown after `can()` or `hasPermission()` without `logAccessDenied`.
- The audit rows of `users.forceVerifyEmail` have no `targetId`: its input names the user `userId`, and the audit middleware reads `id`.
- The manual order-portfolio and KIMO syncs write no audit row.
