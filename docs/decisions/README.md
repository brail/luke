# Architectural Decisions

Decisions in force, by area ([ADR-047](047-documentation-architecture-decisions-in-force-index-by-area-and-short-records.md)):

- [Permissions](in-force/permissions.md)
- [Section access](in-force/section-access.md)
- [Sessions and accounts](in-force/sessions-and-accounts.md)
- [Secrets and sensitive data](in-force/secrets-and-sensitive-data.md)
- [Runtime configuration](in-force/runtime-configuration.md)
- [Storage](in-force/storage.md)
- [Dates and time](in-force/dates-and-time.md)
- [Calendar](in-force/calendar.md)
- [Release and deployment](in-force/release-and-deployment.md)
- [Documentation](in-force/documentation.md)
- [Platform](in-force/platform.md)

<!-- luke-docs:start:adr-index -->
| # | Title | Status |
|---|--------|--------|
| [001](001-jwt-hs256-hkdf.md) | JWT HS256 with HKDF-SHA256 Derivation | Superseded by [020](020-master-key-scope-and-rotation-limits.md) |
| [002](002-rbac-policy.md) | RBAC Policy and Enforcement | Superseded by [006](006-resource-action-permissions.md) |
| [003](003-core-server-only.md) | Core Package Server-Only Exports | Superseded by [022](022-core-package-export-boundary.md) |
| [004](004-prisma-select-only.md) | Prisma Select-Only Pattern | Superseded by [023](023-sensitive-data-outbound-boundary.md) |
| [005](005-shared-zod-schemas.md) | Shared Zod Schemas Pattern | Superseded by [024](024-shared-schemas-and-message-audience.md) |
| [006](006-resource-action-permissions.md) | Resource/Action Permissions System | Superseded by [016](016-static-resource-action-permissions.md) |
| [007](007-storage-layer-refactor.md) | Storage Layer Refactor — Key-Based Storage, MinIO Support, Two-Phase Upload | Superseded by [017](017-key-based-storage-and-two-phase-upload.md) |
| [008](008-appconfig-env-policy.md) | AppConfig KV System and Env Policy | Superseded by [018](018-runtime-configuration-and-bootstrap-environment.md) |
| [009](009-tokenversion-session-invalidation.md) | TokenVersion Multi-Layer Session Invalidation | Superseded by [019](019-tokenversion-session-revocation.md) |
| [010](010-section-access-precedence.md) | Section Access with Four Precedence Layers | Superseded by [021](021-section-access-static-base-and-overrides.md) |
| [011](011-single-instance-scaling-constraint.md) | Single-Instance Constraint and Process-Local State | Accepted |
| [012](012-generic-s3-storage-provider.md) | Generic S3 Storage Provider (Renamed from MinIO) + Swap to SeaweedFS | Accepted |
| [013](013-asset-derivative-pipeline.md) | Automatic Asset Derivative Pipeline (Thumb/Card/Export) | Accepted |
| [014](014-calendar-visibility-single-predicate.md) | Calendar Visibility: a Single Predicate for Read and Notify | Superseded by [041](041-calendar-visibility-function-and-brand-from-one-team.md) |
| [015](015-documentation-architecture-and-canonical-language.md) | Documentation Architecture and Canonical Language | Superseded by [030](030-documentation-architecture-canonical-language-and-historical-records.md) |
| [016](016-static-resource-action-permissions.md) | Static Resource:Action Permissions and Server-Side Enforcement | Superseded by [026](026-resource-action-permissions-enforced.md) |
| [017](017-key-based-storage-and-two-phase-upload.md) | Key-Based Storage References and Two-Phase Upload Confirmation | Superseded by [031](031-key-based-storage-two-phase-upload-and-presigned-buckets.md) |
| [018](018-runtime-configuration-and-bootstrap-environment.md) | Database-Backed Runtime Configuration and Bootstrap-Only Environment | Accepted |
| [019](019-tokenversion-session-revocation.md) | Server-Side Session Revocation with tokenVersion | Superseded by [039](039-session-revocation-tokenversion-and-absolute-lifetime.md) |
| [020](020-master-key-scope-and-rotation-limits.md) | Master Key Scope and Rotation Limits | Accepted |
| [021](021-section-access-static-base-and-overrides.md) | Section Access Resolution: Static Base and Runtime Overrides | Superseded by [025](025-section-access-resolution-derived-parents.md) |
| [022](022-core-package-export-boundary.md) | Core Package Client/Server Export Boundary | Superseded by [037](037-core-package-export-boundary-two-subpaths.md) |
| [023](023-sensitive-data-outbound-boundary.md) | Outbound Boundary for Sensitive Data | Superseded by [032](032-outbound-boundary-for-sensitive-data-and-permission-gated-configuration.md) |
| [024](024-shared-schemas-and-message-audience.md) | Shared Validation Schemas and Message Audience | Accepted |
| [025](025-section-access-resolution-derived-parents.md) | Section Access Resolution: Derived Parents over a Static Base | Superseded by [027](027-section-access-leaf-overrides-and-validated-defaults.md) |
| [026](026-resource-action-permissions-enforced.md) | Resource:Action Permissions: Enforced Coverage, Own-Data Procedures and Admin-Only Operations | Superseded by [029](029-resource-action-permissions-one-builder-logged-refusals.md) |
| [027](027-section-access-leaf-overrides-and-validated-defaults.md) | Section Access: Leaf Overrides, Validated Role Defaults and Migrated Legacy Data | Accepted |
| [028](028-runtime-images-carry-runtime-dependencies-only.md) | Runtime Images Carry Runtime Dependencies Only, and Prove It | Accepted |
| [029](029-resource-action-permissions-one-builder-logged-refusals.md) | Resource:Action Permissions: One Protected Builder, Admin-Only Operations and Logged Refusals | Superseded by [038](038-resource-action-permissions-grants-follow-section-visibility.md) |
| [030](030-documentation-architecture-canonical-language-and-historical-records.md) | Documentation Architecture, Canonical Language and Historical Records | Superseded by [047](047-documentation-architecture-decisions-in-force-index-by-area-and-short-records.md) |
| [031](031-key-based-storage-two-phase-upload-and-presigned-buckets.md) | Key-Based Storage, Two-Phase Upload and Presigned Upload Buckets | Accepted |
| [032](032-outbound-boundary-for-sensitive-data-and-permission-gated-configuration.md) | Outbound Boundary for Sensitive Data and Permission-Gated Configuration Values | Superseded by [034](034-outbound-boundary-for-sensitive-data-and-masked-configuration-reads.md) |
| [033](033-release-identity-versioning-contract-and-release-trains.md) | Release Identity, Versioning Contract and Release Trains | Accepted |
| [034](034-outbound-boundary-for-sensitive-data-and-masked-configuration-reads.md) | Outbound Boundary for Sensitive Data and Masked Configuration Reads | Superseded by [050](050-outbound-boundary-audit-addresses-only-with-users-read.md) |
| [035](035-date-and-time-model-calendar-days-instants-and-two-zone-roles.md) | Date and Time Model: Calendar Days, Instants and Two Zone Roles | Superseded by [036](036-date-and-time-model-moving-both-ends-of-a-timed-event.md) |
| [036](036-date-and-time-model-moving-both-ends-of-a-timed-event.md) | Date and Time Model: Moving Both Ends of a Timed Event by Calendar Days | Accepted |
| [037](037-core-package-export-boundary-two-subpaths.md) | Core Package Export Boundary: Two Subpaths | Accepted |
| [038](038-resource-action-permissions-grants-follow-section-visibility.md) | Resource:Action Permissions: Role Grants Follow Default Section Visibility | Superseded by [042](042-resource-action-permissions-session-only-builder-for-maintenance-reads.md) |
| [039](039-session-revocation-tokenversion-and-absolute-lifetime.md) | Server-Side Session Revocation with tokenVersion and an Absolute Session Lifetime | Superseded by [048](048-session-revocation-signing-out-always-ends-the-browser-session.md) |
| [040](040-calendar-events-access-by-id-and-masking-outside-the-calendar.md) | Calendar Events: Access by Id and Masking Outside the Calendar | Accepted |
| [041](041-calendar-visibility-function-and-brand-from-one-team.md) | Calendar Visibility: Function and Brand from One Team | Accepted |
| [042](042-resource-action-permissions-session-only-builder-for-maintenance-reads.md) | Resource:Action Permissions: a Session-Only Builder for Reads the Maintenance Window Needs | Superseded by [049](049-resource-action-permissions-previews-dialog-reads-and-the-phase-catalog-on-read.md) |
| [043](043-section-access-a-leaf-turns-on-only-with-its-permission.md) | Section Access: a Leaf Turns On Only With Its Permission | Accepted |
| [044](044-pending-user-approval-in-one-transaction.md) | Pending-User Approval in One Transaction | Accepted |
| [045](045-bootstrap-guard-refuses-tls-verification-switched-off.md) | Bootstrap Guard Refuses TLS Verification Switched Off | Accepted |
| [046](046-web-server-refuses-tls-verification-switched-off.md) | Web Server Refuses TLS Verification Switched Off | Accepted |
| [047](047-documentation-architecture-decisions-in-force-index-by-area-and-short-records.md) | Documentation Architecture: Decisions in Force per Area, an Index by Area and Short Records | Accepted |
| [048](048-session-revocation-signing-out-always-ends-the-browser-session.md) | Session Revocation: Signing Out Always Ends the Browser Session | Accepted |
| [049](049-resource-action-permissions-previews-dialog-reads-and-the-phase-catalog-on-read.md) | Resource:Action Permissions: Previews, Dialog Reads and the Phase Catalog on Read | Accepted |
| [050](050-outbound-boundary-audit-addresses-only-with-users-read.md) | Outbound Boundary: Audit Addresses Only With users:read | Accepted |

_Last updated: 2026-11-24_
<!-- luke-docs:end:adr-index -->
