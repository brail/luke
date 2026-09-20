# ADR-012 — Generic S3 Storage Provider (Renamed from MinIO) + Swap to SeaweedFS

## Status

Accepted

## Context

The S3-compatible storage provider introduced in [ADR-007](./007-storage-layer-refactor.md) has always been implemented through the generic `@aws-sdk/client-s3` SDK (no call specific to a MinIO API), but the naming throughout the codebase — the `MinioProvider` class, the `storage.minio.*` AppConfig keys, the `testMinioConnection` tRPC procedure, the UI copy — assumed MinIO was the only possible backend.

In December 2025 MinIO announced maintenance-only mode for the community edition; the GitHub repository was archived (first in February 2026, then again in April 2026): no new binaries, no security patches, no development. The Luke stack used `minio/minio:latest` in all 4 `docker-compose.*.yml` files — vendor lock-in on a now-abandoned project.

## Decision

### 1. A generic rename, not another vendor-specific one

Rename `minio` → `s3` (not `seaweedfs`) throughout the codebase: the `MinioProvider` → `S3Provider` class (`apps/api/src/storage/providers/s3.ts`), the `minioStorageConfigSchema` → `s3StorageConfigSchema` schema, the `storage.minio.*` → `storage.s3.*` AppConfig keys, `storageTypeSchema` `'local' | 'minio'` → `'local' | 's3'`, the `testMinioConnection` → `testS3Connection` tRPC procedure. Renaming to a specific vendor would have repeated the same mistake: if SeaweedFS also stopped being maintained, the same rename work would be needed all over again. The code was already written in a vendor-agnostic way (AWS SDK v3 only) — only consistent naming was missing.

### 2. SeaweedFS as the backend in the Docker stack

All 4 `docker-compose.*.yml` files replace `minio/minio:latest` with `chrislusf/seaweedfs:latest` (all-in-one mode: `weed server -s3`, master+volume+filer+S3 gateway in a single container, the same single-container topology as MinIO). Verified empirically (not merely from declared compatibility) that the generic S3 SDK used by `S3Provider` works against SeaweedFS's S3 gateway: `HeadBucket`/`CreateBucket`, `PutObject`/`GetObject` with Content-Type round-trip, `CopyObject` (used by `fixContentType`), and SigV4 presigned URL generation.

### 3. The `minio-init` sidecar removed, not rewritten

The `mc`-based sidecar (`minio-init`/`minio-rc-init`) created buckets, set an `anonymous download` policy and ILM rules on `temp-*` buckets. Verified that all three functions are redundant or dead, not merely "probably useless":
- bucket creation: already handled idempotently by `S3Provider.init()`, with a more correct bucket list than `minio-init`'s (it includes `collection-row-pictures-revisions`, which `minio-init` did not create);
- public policy: `storageUrl.ts` always routes the `s3` provider through the authenticated proxy — no caller ever uses a direct public URL (`getPublicUrl()` has no runtime callers for the S3 provider);
- `temp-*` buckets + ILM rules: a superseded architecture, no current code writes to `temp-*` buckets any more — the real cleanup (`setupTempFileCleanup()`, `FileObject` rows with `confirmedAt: null`) operates on the real buckets.

SeaweedFS has no direct equivalent of `mc`; since none of the three functions is needed any more, no replacement was written.

### 4. A single migration script, not one per vendor

`apps/api/scripts/migrate-storage.ts` replaces the previous `migrate-storage-to-minio.ts` (hardcoded local→MinIO). A single script parameterised on `--from`/`--to` (`local`/`s3`), with `--from-s3-*`/`--to-s3-*` overrides to build an ad-hoc S3 provider from CLI credentials — necessary for the real case (an existing MinIO → a new SeaweedFS instance, neither of them necessarily the one AppConfig points at during the migration). The same script also handles `local→s3` for anyone starting from scratch. The optional `--fix-mime` flag corrects generic Content-Types both on the `FileObject` record (Postgres) and on the destination S3 object's metadata — the old script corrected only the latter, leaving the download-by-id route serving the wrong header anyway.

## Not Done

- `docs/decisions/007-storage-layer-refactor.md` was not rewritten: it is a historical record of what was decided at that time (already marked "Potentially stale — review needed"), not a living document.
- Object Lock/WORM retention on SeaweedFS is not verified in this project — see [docs/storage-immutable-bucket.md](../storage-immutable-bucket.md).
