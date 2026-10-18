# ADR-031 — Key-Based Storage, Two-Phase Upload and Presigned Upload Buckets

## Status

Accepted

## Context

[ADR-017](017-key-based-storage-and-two-phase-upload.md) stated how an entity refers to a stored file, how a pending upload becomes owned, how abandoned uploads are removed and how stored files are served. That core holds. One of its decisions does not: it let the presigned upload procedures accept every application bucket, and they now accept a single bucket, each with a permission of its own. Under [ADR-030](030-documentation-architecture-canonical-language-and-historical-records.md) that change is recorded by a superseding ADR rather than an erratum.

Several facts ADR-017 relied on changed with it. The specsheet-image upload became two-phase, the `/storage/upload/:uploadId` route, `storage.list` and `merchandisingPlan.addImage` were removed, every component that enumerated buckets now derives them from one list, the cleanup sweep expands a `~/` storage path like the provider does, and upload permissions are recorded by [ADR-029](029-resource-action-permissions-one-builder-logged-refusals.md), not by the superseded ADR-016. Most of ADR-017's observed gaps are closed.

This record supersedes ADR-017 and restates its decision as it holds today. ADR-017 and [ADR-007](007-storage-layer-refactor.md) before it remain as historical records.

## Decision

Entities store bucket-relative keys, URLs are derived when a response is built, and an upload that precedes its entity stays pending until the transaction that saves the entity confirms it.

### Keys, not URLs

- An entity refers to a stored file by its key in a known bucket: `Brand.logoKey`, `CompanyProfile.logoKey`, `CollectionLayoutRow.pictureKey`, `CollectionLayoutRowRevision.pictureKey` and `MerchandisingImage.key`. Uploads, their derivatives and copies into the immutable bucket each get a `FileObject` row, unique by `bucket` and `key`.
- No model stores the URL of a stored file. `makeUrlResolver(prisma)` reads the storage configuration once and returns a synchronous resolver for any number of keys; `resolvePublicUrl` wraps it for a single key.
- Changing the URL configuration needs no change to stored rows, and neither does changing the provider once the objects themselves have been copied.

### Two-phase upload confirmation

- An upload that precedes its owning entity creates a `FileObject` with `confirmedAt: null`. The brand-logo `temp` route, both collection-row-picture routes, the company-logo route and the specsheet-image route do this, and so does `storage.confirmUpload` after a presigned upload.
- To link a pending file, the client passes its `fileObjectId`. The brand and company inputs accept no logo key other than `null`, which removes the logo.
- The file is linked inside the same `$transaction` that writes the entity, through `confirmPendingFile`: in `brand.create`, `brand.update`, `collectionLayout.rows.create`, `collectionLayout.rows.update` and `company.profile.update`, and in the specsheet-image upload, which confirms its own pending file inside the locked transaction that creates the `MerchandisingImage`.
- `confirmPendingFile` returns the key only when the file is still pending, was uploaded by the same user, and belongs to the bucket the caller expects. It confirms the file's derivatives in the same call.

### Presigned uploads

- A client may presign an upload only into a bucket of `PRESIGNED_UPLOAD_BUCKETS`, a separate and narrower list than the application buckets. Today it holds `company-assets` alone.
- Each presigned bucket carries the permission of the procedure that links its files, and `storage.requestUpload` requires it. `storage.confirmUpload` re-checks the bucket of the signed slot against the list, so a slot signed before a bucket left the list is refused.
- The bucket and the key come from the token `storage.requestUpload` signs, never from client input, and the slot's user must be the caller, so a user cannot register another user's object as their own pending file.

### Cleanup of abandoned uploads

- `setupTempFileCleanup` runs at startup and then every 30 minutes. It removes pending master files older than one hour in every asset-kind bucket — `IMAGE_BUCKETS`, derived from the asset kinds, so a new kind is swept without a further edit. It deletes each master's derivative objects first, and keeps the master row when one of them cannot be deleted so that the next run retries it.
- A confirmed file is never swept. A route that stores a file as already confirmed must check that the owning entity exists before it uploads.

### Serving stored files

- With the S3 provider, a file URL is always `/api/uploads/{bucket}/{key}`. The web route behind it requires a session and fetches the object from the API route `/uploads/:bucket/*`, so buckets stay private.
- With local storage, the resolver returns the same proxy URL while `storage.local.enableProxy` is on, which is its default.
- The API route checks no session. It serves only application buckets and relies on the API being unreachable from outside the deployment: in the production and RC compose files only the `web` service publishes a port.

### Application buckets

`APP_STORAGE_BUCKETS` lists the application buckets, and it is the only list: the serving route, provider initialization, and backup and restore all derive from it. `isValidBucket` derives from it too, adding only `backups`. `backups` is deliberately not an application bucket: the serving route refuses it, and no client can presign into it.

### Not decided here

The provider implementation, its configuration keys and the S3 backend belong to [ADR-012](012-generic-s3-storage-provider.md); image validation, normalization and derivatives to [ADR-013](013-asset-derivative-pipeline.md); the immutable `collection-row-pictures-revisions` bucket to [docs/storage-immutable-bucket.md](../storage-immutable-bucket.md); which permission an upload requires to ADR-029. Interface sketches, configuration tables and key-file tables are not carried forward: the code is their source of truth.

## Consequences

- Resolving the URLs of a list of stored files costs a fixed number of configuration reads, not one per file.
- A file reaches storage before the transaction that links it opens. If the transaction fails, the file stays pending until the cleanup job removes it.
- Any cleanup run can remove a pending file older than one hour, so a save that follows a long pause cannot link it. Brand and company saves then reject the request with `BAD_REQUEST`; collection-row saves drop the picture instead (see Observed gaps).
- Making a further bucket presignable is a decision about which permission guards it, not only an edit to a list.
- Turning `storage.local.enableProxy` off makes the resolver return direct API URLs, `{publicBaseUrl}/uploads/{bucket}/{key}`, which work only where browsers can reach the API. If `storage.local.publicBaseUrl` is also unset, resolving any URL throws.

### Observed gaps

These deviations exist when this record is accepted. They are recorded as follow-ups; this record does not endorse them.

- Not every upload is two-phase. `/upload/brand-logo/:brandId` stores the file as confirmed and then writes the brand separately, outside any transaction; if that write fails, the file is an orphan the cleanup job never removes. No web code calls this route.
- Collection-row saves accept a key directly: `CollectionLayoutRowInputSchema` includes `pictureKey`, which the row create and update write without checking for a `FileObject`, and the web form sends the current key back when a row is edited.
- Collection-row saves also ignore a pending id that no longer resolves: they save the row without its picture and report success. The header of the pending-file helper still says the brand ignores a dead id, although both brand mutations reject it.
- The cleanup job deletes files older than two hours from the `.tmp` directories of local storage by reading the filesystem directly, outside `IStorageProvider`, contrary to `CLAUDE.md`.
- The cleanup job does not take a scheduler lock, unlike the periodic schedulers covered by [ADR-011](011-single-instance-scaling-constraint.md).
- `retryFailedCleanups` has no caller and `deleteFileWithRetry` is called only by it; they are the only writers of `FileObject.cleanupStatus`, `cleanupAttempts` and `lastCleanupAt`, which therefore have no live writer.
- The web proxy marks its responses `Cache-Control: public, max-age=31536000, immutable`, which allows a shared cache to store a response that required a session.
- No test covers URL resolution, the cleanup job, or the collection-row confirmation path. Brand, company-logo, specsheet and presigned-upload confirmation are covered.
- The schema comment on `FileObject.bucket` says a bucket must be in `localStorageConfigSchema`, which declares no buckets, and the comment on `CompanyProfile.logoKey` names an `assets` bucket where the logo lives in `company-assets`.
