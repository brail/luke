# Architectural Decisions

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
| [014](014-calendar-visibility-single-predicate.md) | Calendar Visibility: a Single Predicate for Read and Notify | Accepted |
| [015](015-documentation-architecture-and-canonical-language.md) | Documentation Architecture and Canonical Language | Superseded by [030](030-documentation-architecture-canonical-language-and-historical-records.md) |
| [016](016-static-resource-action-permissions.md) | Static Resource:Action Permissions and Server-Side Enforcement | Superseded by [026](026-resource-action-permissions-enforced.md) |
| [017](017-key-based-storage-and-two-phase-upload.md) | Key-Based Storage References and Two-Phase Upload Confirmation | Superseded by [031](031-key-based-storage-two-phase-upload-and-presigned-buckets.md) |
| [018](018-runtime-configuration-and-bootstrap-environment.md) | Database-Backed Runtime Configuration and Bootstrap-Only Environment | Accepted |
| [019](019-tokenversion-session-revocation.md) | Server-Side Session Revocation with tokenVersion | Accepted |
| [020](020-master-key-scope-and-rotation-limits.md) | Master Key Scope and Rotation Limits | Accepted |
| [021](021-section-access-static-base-and-overrides.md) | Section Access Resolution: Static Base and Runtime Overrides | Superseded by [025](025-section-access-resolution-derived-parents.md) |
| [022](022-core-package-export-boundary.md) | Core Package Client/Server Export Boundary | Accepted |
| [023](023-sensitive-data-outbound-boundary.md) | Outbound Boundary for Sensitive Data | Superseded by [032](032-outbound-boundary-for-sensitive-data-and-permission-gated-configuration.md) |
| [024](024-shared-schemas-and-message-audience.md) | Shared Validation Schemas and Message Audience | Accepted |
| [025](025-section-access-resolution-derived-parents.md) | Section Access Resolution: Derived Parents over a Static Base | Superseded by [027](027-section-access-leaf-overrides-and-validated-defaults.md) |
| [026](026-resource-action-permissions-enforced.md) | Resource:Action Permissions: Enforced Coverage, Own-Data Procedures and Admin-Only Operations | Superseded by [029](029-resource-action-permissions-one-builder-logged-refusals.md) |
| [027](027-section-access-leaf-overrides-and-validated-defaults.md) | Section Access: Leaf Overrides, Validated Role Defaults and Migrated Legacy Data | Accepted |
| [028](028-runtime-images-carry-runtime-dependencies-only.md) | Runtime Images Carry Runtime Dependencies Only, and Prove It | Accepted |
| [029](029-resource-action-permissions-one-builder-logged-refusals.md) | Resource:Action Permissions: One Protected Builder, Admin-Only Operations and Logged Refusals | Accepted |
| [030](030-documentation-architecture-canonical-language-and-historical-records.md) | Documentation Architecture, Canonical Language and Historical Records | Accepted |
| [031](031-key-based-storage-two-phase-upload-and-presigned-buckets.md) | Key-Based Storage, Two-Phase Upload and Presigned Upload Buckets | Accepted |
| [032](032-outbound-boundary-for-sensitive-data-and-permission-gated-configuration.md) | Outbound Boundary for Sensitive Data and Permission-Gated Configuration Values | Accepted |
| [033](033-release-identity-versioning-contract-and-release-trains.md) | Release Identity, Versioning Contract and Release Trains | Accepted |

_Last updated: 2026-10-05_
<!-- luke-docs:end:adr-index -->
