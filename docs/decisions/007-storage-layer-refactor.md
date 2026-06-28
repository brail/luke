# ADR-007: Storage Layer Refactor — Key-Based Storage, MinIO Support, Two-Phase Upload

## Status

**Accepted** — 2026-04-22

## Context

Il sistema di storage precedente aveva diverse limitazioni architetturali:

1. **URL nel database**: i modelli (`Brand.logoUrl`, `CollectionLayoutRow.pictureUrl`, `MerchandisingImage.imageUrl`) salvavano URL completi. Cambiare provider o configurazione URL richiedeva una migrazione dati.
2. **Provider unico**: solo filesystem locale. Impossibile usare MinIO o altri object storage senza riscrivere tutta la logica.
3. **Upload immediato e definitivo**: nessun meccanismo per upload "pending" — impossibile caricare un file prima di creare l'entità che lo referenzia.
4. **Validazione duplicata**: `streamToBuffer`, `validateMagicBytes`, `validateFile` riscritti identicamente in ogni service di upload.

## Decision

### 1. Archiviare chiavi, non URL

I campi URL nei modelli sono stati sostituiti con campi `key`:

```
Brand.logoUrl     → Brand.logoKey
CollectionLayoutRow.pictureUrl → CollectionLayoutRow.pictureKey
MerchandisingImage.imageUrl    → MerchandisingImage.key
```

L'URL pubblico viene calcolato a runtime tramite `makeUrlResolver(prisma)` o `resolvePublicUrl(prisma, bucket, key)`. Cambiare provider o configurazione non richiede più migrazioni dati.

### 2. Interfaccia `IStorageProvider` con capabilities

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

Provider implementati: `LocalStorageProvider`, `MinioStorageProvider`. Il provider attivo è selezionato da `storage.type` in AppConfig.

### 3. Two-Phase Upload — FileObject.confirmedAt

Gli upload sono ora in due fasi:

```
Phase 1 — Upload pending:
  POST /upload/brand-logos → putObject(ctx, { pending: true })
  → FileObject creato con confirmedAt = null
  → Ritorna { fileObjectId, publicUrl }

Phase 2 — Conferma al submit del form:
  trpc.brand.create({ ..., fileObjectId })
  → tx: Brand.create + FileObject.update(confirmedAt = now) + Brand.update(logoKey)
  → Se il form viene abbandonato, il cleanup job rimuove i file pending non confermati
```

Il campo `FileObject.confirmedAt = null` indica file pending. Il cleanup job periodico rimuove i file con `confirmedAt IS NULL` più vecchi di N ore.

### 4. URL Resolver Pattern

Per evitare N letture DB consecutive quando si risolvono molti URL:

```typescript
// Un solo read DB per risolvere tutti gli URL di una lista
const resolve = await makeUrlResolver(prisma);
const brands = results.map(b => ({
  ...b,
  logoUrl: b.logoKey ? resolve('brand-logos', b.logoKey) : null,
}));
```

`resolvePublicUrl(prisma, bucket, key)` è una convenience wrapper che chiama `makeUrlResolver` internamente — utile per URL singoli nei service.

### 5. Validazione immagini centralizzata

Le funzioni duplicate `streamToBuffer`, `validateMagicBytes`, `validateImageFile` sono state estratte in `apps/api/src/lib/imageUpload.ts`:

```typescript
export function validateImageFile(
  file: { mimetype: string; size: number; filename: string },
  config: { allowedMimes: readonly string[]; maxSizeBytes: number; allowedExtensions: readonly string[] }
): string  // ritorna sanitizedFilename

export function validateMagicBytes(buffer: Buffer, mimetype: string): boolean

export async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer>
```

Ogni service definisce il proprio `IMAGE_CONFIG` con limiti specifici (brand logo: 2MB, foto riga: 5MB, specsheet: 10MB).

### 6. Proxy URL per MinIO

Con MinIO, i bucket rimangono privati. Le immagini vengono servite tramite la route autenticata Next.js `/api/uploads/[...path]` che verifica la sessione e proxia la richiesta al provider. L'URL generato è sempre nella forma `/api/uploads/{bucket}/{key}` indipendentemente dal provider.

Con storage locale e `enableProxy=true` (default), lo stesso proxy viene usato per consistenza.

## Configurazione

Tutte le chiavi vivono in AppConfig:

| Chiave | Tipo | Default | Descrizione |
|--------|------|---------|-------------|
| `storage.type` | `local` \| `minio` | `local` | Provider attivo |
| `storage.local.basePath` | string | `/data/uploads` | Directory base locale |
| `storage.local.enableProxy` | boolean | `true` | Forza proxy URL anche in locale |
| `storage.local.publicBaseUrl` | string | `""` | Base URL pubblico (se proxy disabilitato) |
| `storage.minio.endpoint` | string | — | Endpoint MinIO (es. `minio:9000`) |
| `storage.minio.accessKey` | string (encrypted) | — | Access key |
| `storage.minio.secretKey` | string (encrypted) | — | Secret key |
| `storage.minio.bucket` | string | `luke` | Nome bucket MinIO |
| `storage.minio.useSSL` | boolean | `false` | HTTPS verso MinIO |
| `storage.minio.presignedPutTtl` | number | `3600` | TTL URL presigned upload (sec) |
| `storage.minio.presignedGetTtl` | number | `3600` | TTL URL presigned download (sec) |

## Bucket validi

Definiti in `localStorageConfigSchema` — non aggiungerne senza aggiornare lo schema:

- `uploads` — file generici
- `exports` — PDF/XLSX generati
- `assets` — asset statici
- `brand-logos` — loghi brand (confermati)
- `temp-brand-logos` — *(deprecato, rimosso nel refactor)*
- `collection-row-pictures` — foto righe collection layout
- `temp-collection-row-pictures` — *(deprecato, rimosso nel refactor)*
- `merchandising-specsheet-images` — immagini specsheet

## Conseguenze

### Positive

- **Provider swap senza migrazioni**: cambiare da local a MinIO richiede solo AppConfig, zero data migration.
- **Upload atomici**: il file pending + conferma nella stessa transaction Prisma — nessuna inconsistenza se il form viene abbandonato.
- **URL sempre corretti**: calcolati a runtime, mai stale nel DB.
- **Validazione DRY**: un'unica funzione per tutti gli upload immagine.

### Negative / Trade-off

- **DB read extra per URL**: ogni response che include URL fa una lettura AppConfig per il resolver. Mitigato da `makeUrlResolver` per batch + cache provider singleton.
- **Cleanup job necessario**: i file pending non confermati devono essere rimossi periodicamente. Il job `retryFailedCleanups` in `brandLogo.service.ts` gestisce anche questo caso.

## File chiave

| File | Ruolo |
|------|-------|
| `packages/core/src/storage/types.ts` | Interfaccia `IStorageProvider`, tipi bucket |
| `packages/core/src/storage/config.ts` | Schema Zod configurazione storage |
| `apps/api/src/storage/index.ts` | Factory provider, `putObject`, `readFileBuffer`, `deleteObjectByKey` |
| `apps/api/src/storage/providers/local.ts` | Provider filesystem locale |
| `apps/api/src/lib/storageUrl.ts` | `makeUrlResolver`, `resolvePublicUrl` |
| `apps/api/src/lib/imageUpload.ts` | `validateImageFile`, `validateMagicBytes`, `streamToBuffer` |
| `apps/api/src/lib/export/image.ts` | `fetchImageBufferFromUrl`, `fetchImageDataUriFromUrl` (per export PDF/XLSX) |
| `apps/api/src/routers/storage.ts` | tRPC router — config CRUD, test connessione, presigned URL |
| `apps/web/src/app/api/uploads/[...path]/route.ts` | Proxy Next.js autenticato |

## Related ADRs

- ADR-003: Core Server Only (i provider storage sono server-only)
- ADR-005: Shared Zod Schemas (schema config in `@luke/core`)
