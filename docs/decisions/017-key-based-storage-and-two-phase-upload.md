# ADR-017 — Key-Based Storage References and Two-Phase Upload Confirmation

## Status

Accepted

## Context

[ADR-007](007-storage-layer-refactor.md) replaced stored file URLs with stored keys, put storage behind a provider interface, and introduced a two-phase upload: a file is uploaded as pending before the entity that owns it is saved, and confirmed when that entity is saved. That core still governs how Luke stores files, but much of what ADR-007 described around it no longer holds. [ADR-012](012-generic-s3-storage-provider.md) renamed the MinIO provider and its `storage.minio.*` keys to a generic S3 provider and `storage.s3.*`. [ADR-013](013-asset-derivative-pipeline.md) routed image uploads through a single asset pipeline and turned `FileObject` into a tree of masters and derivatives. ADR-007's interface sketch, configuration table and bucket list no longer match the code, and the `retryFailedCleanups` job it cites as also handling pending files never runs.

This record supersedes ADR-007 and states the part of it that is decided today: how an entity refers to a stored file, how a pending upload becomes owned, how abandoned uploads are removed, and how stored files are served. ADR-007 remains, translated, as the historical record of the original decision.

## Decision

Entities store bucket-relative keys, URLs are derived when a response is built, and an upload that precedes its entity stays pending until the transaction that saves the entity confirms it.

### Keys, not URLs

- An entity refers to a stored file by its key in a known bucket: `Brand.logoKey`, `CompanyProfile.logoKey`, `CollectionLayoutRow.pictureKey`, `CollectionLayoutRowRevision.pictureKey` and `MerchandisingImage.key`. Uploads, their derivatives and copies into the immutable bucket each get a `FileObject` row, unique by `bucket` and `key`.
- No model stores the URL of a stored file. `makeUrlResolver(prisma)` in `apps/api/src/lib/storageUrl.ts` reads the storage configuration once and returns a synchronous resolver for any number of keys; `resolvePublicUrl` wraps it for a single key.
- Changing the URL configuration needs no change to stored rows, and neither does changing the provider once the objects themselves have been copied.

### Two-phase upload confirmation

- An upload that precedes its owning entity creates a `FileObject` with `confirmedAt: null`. The brand-logo route `/upload/brand-logo/temp`, both collection-row-picture routes and the company-logo route do this, and so does `storage.confirmUpload` after a presigned S3 upload.
- To link a pending file, the client passes its `fileObjectId`. The brand and company inputs accept no logo key other than `null`, which removes the logo.
- The mutation links the file inside the same `$transaction` that writes the entity, by calling `confirmPendingFile` from `apps/api/src/lib/pendingFile.ts`. This applies to create and update flows alike: `brand.create`, `brand.update`, `collectionLayout.rows.create`, `collectionLayout.rows.update` and `company.profile.update`.
- `confirmPendingFile` returns the key only when the file is still pending, was uploaded by the same user, and belongs to the bucket the caller expects. It confirms the file's derivatives in the same call.
- For a presigned S3 upload, the bucket and key come from the token signed by `storage.requestUpload`, never from client input, so a user cannot register another user's object as their own pending file.

### Cleanup of abandoned uploads

- `setupTempFileCleanup` in `apps/api/src/server.ts` runs at startup and then every 30 minutes. It removes pending master files older than one hour in `brand-logos`, `company-assets`, `collection-row-pictures` and `merchandising-specsheet-images`. It deletes each master's derivative objects first, and keeps the master row when one of them cannot be deleted so that the next run retries it.
- A confirmed file is never swept. A route that stores a file as already confirmed must check that the owning entity exists before it uploads.

### Serving stored files

- With the S3 provider, a file URL is always `/api/uploads/{bucket}/{key}`. The Next.js route `apps/web/src/app/api/uploads/[...path]/route.ts` requires a session and fetches the object from the API route `/uploads/:bucket/*`, so buckets stay private.
- With local storage, the resolver returns the same proxy URL while `storage.local.enableProxy` is on, which is its default.
- The API route checks no session. It serves only buckets in `APP_STORAGE_BUCKETS` and relies on the API being unreachable from outside the deployment: in `docker-compose.prod.yml` only the `web` service publishes a port.

### Application buckets

`APP_STORAGE_BUCKETS` in `packages/core/src/storage/types.ts` lists the application buckets. The upload inputs of the storage router use it through `z.enum`, and `isValidBucket` derives from it, adding only `backups`. `backups` is deliberately not an application bucket: the generic API route refuses it.

### Not decided here

The provider implementation, its configuration keys and the S3 backend belong to ADR-012; image validation, normalization and derivatives to ADR-013; the immutable `collection-row-pictures-revisions` bucket to [docs/storage-immutable-bucket.md](../storage-immutable-bucket.md); which permission an upload requires to [ADR-016](016-static-resource-action-permissions.md). ADR-007's interface sketch, configuration table and key-file table are not carried forward: the code is their source of truth.

## Consequences

- Resolving the URLs of a list of stored files costs a fixed number of configuration reads, not one per file.
- A file reaches storage before the transaction that links it opens. If the transaction fails, the file stays pending until the cleanup job removes it.
- Any cleanup run can remove a pending file older than one hour, so a save that follows a long pause cannot link it. Brand and company saves then reject the request with `BAD_REQUEST` instead of saving the entity without its logo.
- Turning `storage.local.enableProxy` off makes the resolver return direct API URLs, `{publicBaseUrl}/uploads/{bucket}/{key}`, which work only where browsers can reach the API. If `storage.local.publicBaseUrl` is also unset, resolving any URL throws.

### Observed gaps

These are recorded as follow-ups. This record does not endorse them.

- Not every upload is two-phase. `/upload/brand-logo/:brandId` (`uploadBrandLogo`) and `/upload/specsheet-image/:specsheetId` (`uploadSpecsheetImage`) store the file as confirmed and then write the entity separately, outside any transaction; if that write fails, the file is an orphan the cleanup job never removes. The web client uses the pending brand-logo route, but the confirmed specsheet route. `merchandisingPlan.addImage` stores a client-supplied key without checking that a matching `FileObject` exists; no web code calls it.
- Collection row saves accept a key directly. `CollectionLayoutRowInputSchema` includes `pictureKey`, which `collectionLayout.rows.create` and `collectionLayout.rows.update` write without checking for a `FileObject`, and the web form sends the current key back when a row is edited.
- Collection row saves also ignore a pending id that no longer resolves: they save the row without its picture and report success. The header of `apps/api/src/lib/pendingFile.ts` still says the brand ignores a dead id, although both brand mutations now reject it.
- `storage.requestUpload` and `storage.confirmUpload` accept every bucket in `APP_STORAGE_BUCKETS` and require nothing beyond authentication, unlike the per-bucket rule of the `/storage/upload/:uploadId` route. A pending file they create in `uploads`, `exports`, `assets` or `collection-row-pictures-revisions` is never swept, although the comment in `confirmUpload` says an abandoned upload falls under the cleanup job.
- `storage.list` takes its bucket filter as a free string, checks it with `isValidBucket`, which also admits `backups`, and casts it with `as any`, contrary to rule 15 of `CLAUDE.md`.
- The bucket list is spelled out again, contrary to `CLAUDE.md`: in the cleanup job's query and type casts, in `S3Provider.init` (`apps/api/src/storage/providers/s3.ts`, together with `backups`), in `VALID_BUCKETS` in `packages/core/src/storage/contracts.ts`, and in the bucket check of `apps/api/src/plugins/storageUpload.ts`.
- The cleanup job also deletes files older than two hours from the `.tmp` directories of local storage by reading the filesystem directly, outside `IStorageProvider`, contrary to `CLAUDE.md`. It resolves `storage.local.basePath` without the `~/` expansion that `loadLocalProvider` in `apps/api/src/storage/index.ts` applies, so for a `~/` path the sweep finds nothing and reports no error.
- The cleanup job does not use `withSchedulerLock`, which the periodic schedulers covered by [ADR-011](011-single-instance-scaling-constraint.md) and the derivative reconcile tick do use.
- `retryFailedCleanups` in `apps/api/src/services/brandLogo.service.ts` has no caller, and `deleteFileWithRetry` is called only by it. They are the only writers of `FileObject.cleanupStatus`, `cleanupAttempts` and `lastCleanupAt`. The header of `apps/api/src/lib/assets/derivativeWorker.ts` still lists `retryFailedCleanups` among the periodic sweeps.
- The web proxy marks its responses `Cache-Control: public, max-age=31536000, immutable`, which allows a shared cache to store a response that required a session.
- No test covers URL resolution or the cleanup job, and no API test exercises the collection-row confirmation path.
- The schema comment on `FileObject.bucket` says a bucket must be in `localStorageConfigSchema`, which declares no buckets.
