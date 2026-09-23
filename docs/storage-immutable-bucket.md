# Storage — Immutable Bucket

## collection-row-pictures-revisions

Destination bucket for the photos of the Collection Layout rows included in
formal revisions (ISO 9001:2015 quality register).

### Who writes

`copyToImmutableBucket()` in `apps/api/src/storage/index.ts`. The
`collectionLayoutRevision.create` procedure passes it to the `createRevision`
service, which calls it for every row with a photo BEFORE the Prisma
transaction.

Only manual revisions copy photos here. Automatic MILESTONE revisions pass a
callback that returns the source key unchanged, so their `pictureKey` still
names an object in `collection-row-pictures` (`identityCopyPhoto` in
`apps/api/src/services/collectionLayoutAutoRevision.service.ts`).

The generic paths that accept any bucket in `APP_STORAGE_BUCKETS` can also
write here: backup restore, and the presigned `storage.requestUpload` /
`storage.confirmUpload` pair, which requires nothing beyond authentication (see
[ADR-017](decisions/017-key-based-storage-and-two-phase-upload.md)).

### Who reads

- The `getRevisionDetail` service → for the revision drill-down
- The `getLayoutAsOfRevision` service → for time travel
- Frontend: the revision page
  (`/product/collection-layout/revisions/[revisionId]`) shows the snapshot
  photos through the storage proxy
- Revision exports (`collectionLayoutRevision.export.xlsx` / `.pdf`) embed the
  photos read from this bucket

### CAS semantics (Content-Addressable Storage)

Before a file is copied, an existing `FileObject` with the same `bucket` and
`checksumSha256` is looked up. If one is found, the existing key is returned
without copying.

This keeps rows with byte-identical photos from creating duplicates in the
bucket; the common case is a photo that has not changed between revisions,
since every revision copies the photo of every row. It is a lookup, not a
guarantee: `FileObject` is unique only on `bucket` + `key`, so copies of
identical content that run concurrently can each miss the lookup and upload
their own copy. The photos of one revision are copied in parallel, so two of
its rows sharing a photo are enough.

### Orphan files

If the revision transaction fails after `copyToImmutableBucket`:
- The file is in the bucket, but no `CollectionLayoutRowRevision.pictureKey`
  record references it
- Its `FileObject` row, written outside the transaction, survives, so a
  retried revision finds it through the checksum lookup and reuses it instead
  of uploading a second copy
- No job removes it: the row is written already confirmed, and the
  pending-file cleanup (`setupTempFileCleanup` in `apps/api/src/server.ts`)
  does not cover this bucket. A bucket lifecycle rule cannot remove it either:
  S3 lifecycle rules select objects by prefix, tag, size and age, not by
  whether a database row references them

### Retention policy configuration (production)

Object Lock (versioning + WORM retention) is a standard S3 feature, not
specific to one vendor. It is configured through the S3 API
(`PutBucketVersioning` + `PutObjectLockConfiguration`/`PutObjectRetention`),
not through the application's storage provider (`IStorageProvider` exposes no
bucket policy or retention; that is outside its scope and has to be done at the
storage-backend level). It applies only when `storage.type` is `s3`: with the
default `local` provider, the bucket is a plain directory under
`storage.local.basePath`.

The Docker stack runs SeaweedFS, which supports Object Lock (GOVERNANCE and
COMPLIANCE modes, Legal Hold) from release 3.94 onwards. **Not verified in this
project**: before relying on `compliance` for a real legal requirement, verify
it against the SeaweedFS version actually deployed. The upstream report of
deletes succeeding in `compliance` mode, seaweedfs/seaweedfs#8350, was closed
as not planned in February 2026: the delete it reported carried no version ID,
which under S3 semantics succeeds by adding a delete marker while the locked
version survives. A follow-up, seaweedfs/seaweedfs#11333, was closed in
September 2026 after the maintainer could not reproduce a versioned delete
succeeding and added tests for it (seaweedfs/seaweedfs#11335). The earlier
thread also asks whether the protection extends to the filer, a SeaweedFS
component that the stack's `weed server` also runs and that can delete files
outside the S3 gateway; treat it as a separate path to guard. With MinIO (if still in use for an existing installation)
the same setup used `mc versioning enable` +
`mc retention set --default compliance ...`, which MinIO's community edition
accepts only on a bucket created with object locking (`mc mb --with-lock`); the
application creates missing buckets without it (`S3Provider.init()`). With
SeaweedFS the equivalent goes through the standard S3 API
(`aws s3api put-object-lock-configuration` / `put-object-retention`), not
through an `mc`-style CLI.

**IMPORTANT**: with retention in compliance mode, not even the admin should be
able to delete files before they expire — but see the caveat above before
treating that as guaranteed. The protection covers object versions: the
application's delete (`S3Provider.delete`) sends no version ID, so on a locked
bucket it still succeeds by adding a delete marker, after which the
application's reads, which carry no version ID either, no longer find the
file. Evaluate this against the customer's legal requirements, and explicitly
test delete behaviour against the build actually in production before
considering the bucket truly immutable.

### Application permissions

Nothing in this repository restricts the application's delete rights on this
bucket. The SeaweedFS S3 gateway of the Docker stack knows a single identity,
with `Admin`, `Read`, `Write`, `List` and `Tagging` on every bucket
(`docker/seaweedfs/entrypoint.sh`), and the application reaches every bucket
with the one credential pair in `storage.s3.accessKey` /
`storage.s3.secretKey`. The revision service implements no delete, but the
generic `storage.delete` procedure (`config:update`, admin only) deletes any
`FileObject` by id with no bucket check, files in this bucket included.

---

## Relationship to Collection Layout versioning

See [docs/collection-layout-versioning.md](./collection-layout-versioning.md)
for the full flow.
