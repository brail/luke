# Architectural Decisions

<!-- luke-docs:start:adr-index -->
| # | Title | Status |
|---|--------|--------|
| [001](001-jwt-hs256-hkdf.md) | JWT HS256 with HKDF-SHA256 Derivation | Superseded by [020](020-master-key-scope-and-rotation-limits.md) |
| [002](002-rbac-policy.md) | RBAC Policy and Enforcement | Superseded by [006](006-resource-action-permissions.md) |
| [003](003-core-server-only.md) | Core Package Server-Only Exports | Accepted |
| [004](004-prisma-select-only.md) | Prisma Select-Only Pattern | Accepted |
| [005](005-shared-zod-schemas.md) | Shared Zod Schemas Pattern | Accepted |
| [006](006-resource-action-permissions.md) | Resource/Action Permissions System | Superseded by [016](016-static-resource-action-permissions.md) |
| [007](007-storage-layer-refactor.md) | Storage Layer Refactor — Key-Based Storage, MinIO Support, Two-Phase Upload | Superseded by [017](017-key-based-storage-and-two-phase-upload.md) |
| [008](008-appconfig-env-policy.md) | AppConfig KV System and Env Policy | Superseded by [018](018-runtime-configuration-and-bootstrap-environment.md) |
| [009](009-tokenversion-session-invalidation.md) | TokenVersion Multi-Layer Session Invalidation | Superseded by [019](019-tokenversion-session-revocation.md) |
| [010](010-section-access-precedence.md) | Section Access with Four Precedence Layers | Accepted |
| [011](011-single-instance-scaling-constraint.md) | Single-Instance Constraint and Process-Local State | Accepted |
| [012](012-generic-s3-storage-provider.md) | Generic S3 Storage Provider (Renamed from MinIO) + Swap to SeaweedFS | Accepted |
| [013](013-asset-derivative-pipeline.md) | Automatic Asset Derivative Pipeline (Thumb/Card/Export) | Accepted |
| [014](014-calendar-visibility-single-predicate.md) | Calendar Visibility: a Single Predicate for Read and Notify | Accepted |
| [015](015-documentation-architecture-and-canonical-language.md) | Documentation Architecture and Canonical Language | Accepted |
| [016](016-static-resource-action-permissions.md) | Static Resource:Action Permissions and Server-Side Enforcement | Accepted |
| [017](017-key-based-storage-and-two-phase-upload.md) | Key-Based Storage References and Two-Phase Upload Confirmation | Accepted |
| [018](018-runtime-configuration-and-bootstrap-environment.md) | Database-Backed Runtime Configuration and Bootstrap-Only Environment | Accepted |
| [019](019-tokenversion-session-revocation.md) | Server-Side Session Revocation with tokenVersion | Accepted |
| [020](020-master-key-scope-and-rotation-limits.md) | Master Key Scope and Rotation Limits | Accepted |

_Last updated: 2026-09-21_
<!-- luke-docs:end:adr-index -->
