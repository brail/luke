# Decisioni architetturali

<!-- luke-docs:start:adr-index -->
| # | Titolo | Status |
|---|--------|--------|
| [001](001-jwt-hs256-hkdf.md) | JWT HS256 con Derivazione HKDF-SHA256 | Accepted |
| [002](002-rbac-policy.md) | RBAC Policy e Enforcement | Superseded by [006](006-resource-action-permissions.md) |
| [003](003-core-server-only.md) | Core Package Server-Only Exports | Accepted |
| [004](004-prisma-select-only.md) | Prisma Select-Only Pattern | Accepted |
| [005](005-shared-zod-schemas.md) | Shared Zod Schemas Pattern | Accepted |
| [006](006-resource-action-permissions.md) | Resource/Action Permissions System | Potentially stale — review needed |
| [007](007-storage-layer-refactor.md) | Storage Layer Refactor — Key-Based Storage, MinIO, Two-Phase Upload | Potentially stale — review needed |
| [008](008-appconfig-env-policy.md) | AppConfig KV System e Env Policy | Potentially stale — review needed |
| [009](009-tokenversion-session-invalidation.md) | TokenVersion Multi-Layer Session Invalidation | Potentially stale — review needed |
| [010](010-section-access-precedence.md) | Section Access a 4 Layer di Precedenza | Accepted |
| [011](011-single-instance-scaling-constraint.md) | Vincolo Single-Instance e Stato Process-Local | Accepted |
| [012](012-generic-s3-storage-provider.md) | Provider Storage S3 Generico (rename da MinIO) + Swap a SeaweedFS | Accepted |
| [013](013-asset-derivative-pipeline.md) | Pipeline Automatica dei Derivati Asset (Thumb/Card/Export) | Accepted |
| [014](014-calendar-visibility-single-predicate.md) | Visibilità Calendario: un Predicato Unico per Lettura e Notifica | Accepted |

*Ultimo aggiornamento: 2026-08-31*
<!-- luke-docs:end:adr-index -->
