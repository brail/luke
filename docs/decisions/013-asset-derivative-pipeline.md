# ADR-013 — Automatic Asset Derivative Pipeline (Thumb/Card/Export)

## Status

Accepted

## Context

During the 2.0.0 release, PDF/XLSX exports broke on `CollectionLayoutRow` photos. The workaround shipped at the time was a runtime resize (`resizeForEmbed` in [apps/api/src/lib/export/image.ts](../../apps/api/src/lib/export/image.ts)): every export re-decodes the multi-MB master image, per row, in all three export services. The CPU/RAM spike wasn't removed, just moved from upload time to export time.

Investigating that fix surfaced two upstream defects that a runtime resize can never solve, both consequences of the same root cause: **the master is the only version of an image that ever exists, and it is never normalized.**

1. **WebP masters silently vanish from exports.** The `toDataUri`-style helpers returned `null` for `.webp` (`collectionLayout.export.pdf.service.ts`, duplicated in `pricing.export.service.ts`), yet `image/webp` was in `allowedMimes` on all four upload paths. No error, no log — the photo just never appears in the document.
2. **Content-type was deduced from the key's file extension, never verified against decoded bytes.** `validateImageFile` validated MIME and extension independently, never checked that they agreed; a `foto.jpg` containing PNG bytes passed validation and was then labeled `image/jpeg` downstream. `copyToImmutableBucket` hardcoded `contentType: 'image/jpeg'` for any source.

Separately, four upload paths (`collectionRowPicture.service.ts`, `brandLogo.service.ts`, `companyLogo.service.ts`, `specsheetImage.service.ts`) each carried near-identical validate → buffer → magic-bytes → `putObject` code with their own local `IMAGE_CONFIG`. Every future upload surface would have meant copying that block again.

## Decision

### 1. Declarative registry, not sharp calls scattered across services

[packages/core/src/storage/assets.ts](../../packages/core/src/storage/assets.ts) has no dependency on `sharp` — it must be importable from the browser too. It exports `ASSET_PIPELINE_VERSION`, the `ASSET_VARIANTS` presets (`thumb`/`card`/`export`, each with `maxWidth`/`maxHeight`/`format`/`quality`), `ASSET_KINDS` (one entry per upload path: bucket, allowed MIME/extensions, max size, which variants to generate, which one is generated synchronously), and the deterministic `buildVariantKey()` builder. **Adding a new upload path in the future costs one registry entry, not a copied service.**

### 2. Pure normalization/derivation functions, unit-testable without infrastructure

[apps/api/src/lib/assets/pipeline.ts](../../apps/api/src/lib/assets/pipeline.ts): `normalizeMaster()` bakes and strips EXIF orientation (`.rotate()`), converts to sRGB, and derives content-type from the actually-decoded bytes — never the extension (the direct fix for defect 2). `deriveVariant()` never upscales (`fit:'inside'`, `withoutEnlargement:true`) and picks PNG over JPEG automatically when the source has alpha, so logos keep their transparency. Both are buffer-in/buffer-out with no DB, storage, or request context. Guarded against decompression bombs (`limitInputPixels`, `sequentialRead`, `failOn:'error'`) — a few compressed MB can decode to tens of thousands of pixels per side.

### 3. One orchestrator replaces four duplicated services

[apps/api/src/services/asset.service.ts](../../apps/api/src/services/asset.service.ts)'s `ingestImageAsset()` is the single entry point every upload path now calls. It generates the kind's one "sync" variant inline (immediate preview) and defers the rest to the background worker. A master that genuinely fails to decode is marked `FAILED` immediately — retrying sharp against the same undecodable bytes later would just fail again. A master that decoded fine but hasn't produced a given variant yet (worker still running, kill switch off, a race) degrades to serving the master's own bytes — with one deliberate exception, see §7.

### 4. `FileObject` becomes a tree, not a flat list

`parentId`/`variant`/`pipelineVersion`/`width`/`height`/`derivativesStatus`/`derivativeAttempts` turn `FileObject` into a self-relation: `parentId = null` rows are masters, everything else is a derivative. `onDelete: Cascade` on that relation is intentional — a derivative without its master is meaningless, it's cache, not data. Cascade only removes the DB row; the physical object in the storage provider needs explicit cleanup, added to both `deleteObject`/`deleteObjectByKey` and the orphan-file reaper in `server.ts`.

### 5. Bounded background worker + periodic reconciliation

[apps/api/src/lib/assets/derivativeWorker.ts](../../apps/api/src/lib/assets/derivativeWorker.ts): `enqueueDerivatives()` is fire-and-forget from the upload path, concurrency-capped with `p-limit` (same constant/rationale as `IMAGE_FETCH_CONCURRENCY` in `lib/export/concurrency.ts`) — without the cap, a burst of concurrent uploads would spawn unbounded parallel sharp work, the exact OOM class this whole pipeline exists to fix. `registerDerivativeScheduler` runs a 5-minute reconcile tick, guarded by `withSchedulerLock` per [ADR-011](011-single-instance-scaling-constraint.md), that picks up crashed/missed masters, retries failures up to 5 attempts, catches masters whose derivatives are stale on `pipelineVersion`, and doubles as the engine for backfill (`scripts/backfill-asset-derivatives.ts`) — no separate backfill code path.

### 6. Kill switch checked live, never cached

`storage.derivatives.enabled` (AppConfig) is read fresh on every call site that matters — sync ingest, the worker, the reconcile tick — not cached. An incident-time toggle must take effect on the next call, not after a cache TTL expires.

### 7. The `export` variant's WebP guarantee is enforced on the read side too

`readAssetBuffer()` resolves a specific variant using the row's own stored content-type and dimensions — never re-derived from the key's extension (the direct fix for defect 1). The `export` variant is guaranteed non-WebP by construction (pdfmake/exceljs can't embed WebP). If that variant isn't ready yet and the fallback would be a WebP master, `readAssetBuffer` returns `null` instead of the raw bytes: refusing to serve a picture is preferable to silently reproducing the exact 2.0.0 bug this pipeline was built to fix.

## Consequences

- Storage footprint grows roughly 1.4–1.8× (the master dominates; thumb/card are small, export is the same order of magnitude as the master) — not yet measured against a real production sample.
- Every `FileObject` predating this pipeline gets `derivativesStatus = 'PENDING'` for free from the migration's column default; the reconcile tick or `scripts/backfill-asset-derivatives.ts` picks them up with no bespoke migration logic.
- `resizeForEmbed` stays in place as a fallback safety net on the master-serving path. Its own implementation quality was explicitly out of scope for this decision and is tracked separately.
- `putObject`/`copyToImmutableBucket` now carry the real decoded content-type instead of a hardcoded/extension-guessed one, closing defect 2 for every consumer, not just the export path.

## Not done

- **AppConfig-level caching for the kill switch.** Deliberately skipped — caching would delay an incident-time toggle from taking effect, which defeats the point of having one.
- **In-flight de-duplication for `enqueueDerivatives`.** Two near-simultaneous triggers for the same master (e.g. upload + a read-side enqueue) both queue a `processMaster` run. Judged low real-world risk relative to the complexity of adding it: the unique constraint on `(parentId, variant, pipelineVersion)` already makes the losing writer's attempt a no-op, not a correctness bug.
