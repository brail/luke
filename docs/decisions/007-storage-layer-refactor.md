# ADR-007: Storage Layer Refactor — Key-Based Storage, MinIO Support, Two-Phase Upload

## Status

Superseded by [017 — Key-Based Storage References and Two-Phase Upload Confirmation](017-key-based-storage-and-two-phase-upload.md)

## Context

The previous storage system had several architectural limitations:

1. **URLs in the database**: the models (`Brand.logoUrl`, `CollectionLayoutRow.pictureUrl`, `MerchandisingImage.imageUrl`) stored full URLs. Changing the provider or the URL configuration required a data migration.
2. **Single provider**: local filesystem only. Using MinIO or any other object storage was impossible without rewriting all of the logic.
3. **Immediate and final upload**: no mechanism for "pending" uploads — a file could not be uploaded before creating the entity that references it.
4. **Duplicated validation**: `streamToBuffer`, `validateMagicBytes`, `validateFile` rewritten identically in every upload service.

## Decision

### 1. Store keys, not URLs

The URL fields in the models were replaced with `key` fields:

```
Brand.logoUrl     → Brand.logoKey
CollectionLayoutRow.pictureUrl → CollectionLayoutRow.pictureKey
MerchandisingImage.imageUrl    → MerchandisingImage.key
```

The public URL is computed at runtime through `makeUrlResolver(prisma)` or `resolvePublicUrl(prisma, bucket, key)`. Changing the provider or the configuration no longer requires data migrations.

### 2. `IStorageProvider` interface with capabilities

```typescript
interface IStorageProvider {
  put(params: PutParams): Promise<FileObject>;
  get(params: GetParams): Promise<NodeJS.ReadableStream>;
  delete(params: DeleteParams): Promise<void>;
  capabilities: {
    supportsPresignedUpload: boolean;
    supportsPresignedDownload: boolean;
  };
  getPresignedPutUrl?(params: PresignedPutParams): Promise<string>;
  getPresignedGetUrl?(params: PresignedGetParams): Promise<string>;
}
```

Implemented providers: `LocalStorageProvider`, `MinioStorageProvider`. The active provider is selected by `storage.type` in AppConfig.

### 3. Two-Phase Upload — FileObject.confirmedAt

Uploads now happen in two phases:

```
Phase 1 — Upload pending:
  POST /upload/brand-logos → putObject(ctx, { pending: true })
  → FileObject created with confirmedAt = null
  → Returns { fileObjectId, publicUrl }

Phase 2 — Confirmation on form submit:
  trpc.brand.create({ ..., fileObjectId })
  → tx: Brand.create + FileObject.update(confirmedAt = now) + Brand.update(logoKey)
  → If the form is abandoned, the cleanup job removes the unconfirmed pending files
```

The `FileObject.confirmedAt = null` field marks a pending file. The periodic cleanup job removes files with `confirmedAt IS NULL` older than N hours.

### 4. URL Resolver Pattern

To avoid N consecutive DB reads when resolving many URLs:

```typescript
// A single DB read to resolve every URL in a list
const resolve = await makeUrlResolver(prisma);
const brands = results.map(b => ({
  ...b,
  logoUrl: b.logoKey ? resolve('brand-logos', b.logoKey) : null,
}));
```

`resolvePublicUrl(prisma, bucket, key)` is a convenience wrapper that calls `makeUrlResolver` internally — useful for single URLs in services.

### 5. Centralized image validation

The duplicated functions `streamToBuffer`, `validateMagicBytes`, `validateImageFile` were extracted into `apps/api/src/lib/imageUpload.ts`:

```typescript
export function validateImageFile(
  file: { mimetype: string; size: number; filename: string },
  config: { allowedMimes: readonly string[]; maxSizeBytes: number; allowedExtensions: readonly string[] }
): string  // returns sanitizedFilename

export function validateMagicBytes(buffer: Buffer, mimetype: string): boolean

export async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer>
```

Each service defines its own `IMAGE_CONFIG` with specific limits (brand logo: 2MB, row picture: 5MB, specsheet: 10MB).

### 6. Proxy URL for MinIO

With MinIO, the buckets remain private. Images are served through the authenticated Next.js route `/api/uploads/[...path]`, which verifies the session and proxies the request to the provider. The generated URL always has the form `/api/uploads/{bucket}/{key}`, regardless of the provider.

With local storage and `enableProxy=true` (default), the same proxy is used for consistency.

## Configuration

All keys live in AppConfig:

| Key | Type | Default | Description |
|--------|------|---------|-------------|
| `storage.type` | `local` \| `minio` | `local` | Active provider |
| `storage.local.basePath` | string | `/data/uploads` | Local base directory |
| `storage.local.enableProxy` | boolean | `true` | Forces proxy URLs for local storage too |
| `storage.local.publicBaseUrl` | string | `""` | Public base URL (if the proxy is disabled) |
| `storage.minio.endpoint` | string | — | MinIO endpoint (e.g. `minio:9000`) |
| `storage.minio.accessKey` | string (encrypted) | — | Access key |
| `storage.minio.secretKey` | string (encrypted) | — | Secret key |
| `storage.minio.bucket` | string | `luke` | MinIO bucket name |
| `storage.minio.useSSL` | boolean | `false` | HTTPS to MinIO |
| `storage.minio.presignedPutTtl` | number | `3600` | Presigned upload URL TTL (sec) |
| `storage.minio.presignedGetTtl` | number | `3600` | Presigned download URL TTL (sec) |

## Valid buckets

Defined in `APP_STORAGE_BUCKETS` (`packages/core/src/storage/types.ts`), the only list:

- `uploads` — generic files
- `exports` — generated PDF/XLSX
- `assets` — static assets
- `brand-logos` — brand logos (confirmed)
- `temp-brand-logos` — *(deprecated, removed in the refactor)*
- `collection-row-pictures` — collection layout row pictures
- `temp-collection-row-pictures` — *(deprecated, removed in the refactor)*
- `merchandising-specsheet-images` — specsheet images

## Consequences

### Positive

- **Provider swap without migrations**: switching from local to MinIO requires only AppConfig, zero data migration.
- **Atomic uploads**: the pending file + confirmation in the same Prisma transaction — no inconsistency if the form is abandoned.
- **Always-correct URLs**: computed at runtime, never stale in the DB.
- **DRY validation**: a single function for every image upload.

### Negative / Trade-off

- **Extra DB read for URLs**: every response that includes URLs performs an AppConfig read for the resolver. Mitigated by `makeUrlResolver` for batches + the singleton provider cache.
- **Cleanup job required**: unconfirmed pending files must be removed periodically. The `retryFailedCleanups` job in `brandLogo.service.ts` also handles this case.

## Key files

| File | Role |
|------|-------|
| `packages/core/src/storage/types.ts` | `IStorageProvider` interface, bucket types |
| `packages/core/src/storage/config.ts` | Zod schema for the storage configuration |
| `apps/api/src/storage/index.ts` | Provider factory, `putObject`, `readFileBuffer`, `deleteObjectByKey` |
| `apps/api/src/storage/providers/local.ts` | Local filesystem provider |
| `apps/api/src/lib/storageUrl.ts` | `makeUrlResolver`, `resolvePublicUrl` |
| `apps/api/src/lib/imageUpload.ts` | `validateImageFile`, `validateMagicBytes`, `streamToBuffer` |
| `apps/api/src/lib/export/image.ts` | `fetchImageBufferFromUrl`, `fetchImageDataUriFromUrl` (for PDF/XLSX export) |
| `apps/api/src/routers/storage.ts` | tRPC router — config CRUD, connection test, presigned URL |
| `apps/web/src/app/api/uploads/[...path]/route.ts` | Authenticated Next.js proxy |

## Related ADRs

- ADR-003: Core Server Only (the storage providers are server-only)
- ADR-005: Shared Zod Schemas (config schemas in `@luke/core`)
