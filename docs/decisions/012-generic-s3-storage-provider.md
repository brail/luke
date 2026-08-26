# ADR-012 — Provider Storage S3 Generico (rename da MinIO) + Swap a SeaweedFS

## Status

Accepted

## Contesto

Il provider storage S3-compatible introdotto in [ADR-007](./007-storage-layer-refactor.md) è sempre stato implementato tramite l'SDK generico `@aws-sdk/client-s3` (nessuna chiamata specifica a un'API MinIO), ma il naming in tutto il codebase — classe `MinioProvider`, chiavi AppConfig `storage.minio.*`, procedura tRPC `testMinioConnection`, copy in UI — presumeva MinIO come unico backend possibile.

A dicembre 2025 MinIO ha annunciato la modalità maintenance-only per la community edition; la repo GitHub è stata archiviata (prima a febbraio 2026, poi di nuovo ad aprile 2026): nessun nuovo binario, nessuna patch di sicurezza, nessuno sviluppo. Lo stack Luke usava `minio/minio:latest` in tutti e 4 i file `docker-compose.*.yml` — un vendor lock-in su un progetto ora abbandonato.

## Decisione

### 1. Rename generico, non un altro rename vendor-specifico

Rinominare `minio` → `s3` (non `seaweedfs`) in tutto il codebase: classe `MinioProvider` → `S3Provider` (`apps/api/src/storage/providers/s3.ts`), schema `minioStorageConfigSchema` → `s3StorageConfigSchema`, chiavi AppConfig `storage.minio.*` → `storage.s3.*`, `storageTypeSchema` `'local' | 'minio'` → `'local' | 's3'`, procedura tRPC `testMinioConnection` → `testS3Connection`. Rinominare a un vendor specifico avrebbe ripetuto lo stesso errore: se anche SeaweedFS smettesse di essere mantenuto, servirebbe lo stesso lavoro di rename da capo. Il codice era già scritto in modo agnostico (solo AWS SDK v3) — mancava solo il naming coerente.

### 2. SeaweedFS come backend nello stack Docker

Tutti e 4 i `docker-compose.*.yml` sostituiscono `minio/minio:latest` con `chrislusf/seaweedfs:latest` (modalità all-in-one: `weed server -s3`, master+volume+filer+S3 gateway in un solo container, stessa topologia a container singolo di MinIO). Verificato empiricamente (non solo per compatibilità dichiarata) che l'SDK S3 generico usato da `S3Provider` funziona contro il gateway S3 di SeaweedFS: `HeadBucket`/`CreateBucket`, `PutObject`/`GetObject` con round-trip del Content-Type, `CopyObject` (usato da `fixContentType`), e generazione di URL presigned SigV4.

### 3. Sidecar `minio-init` eliminato, non riscritto

Il sidecar `mc`-based (`minio-init`/`minio-rc-init`) creava bucket, impostava policy `anonymous download` e regole ILM su bucket `temp-*`. Verificato che tutte e tre le funzioni sono ridondanti o morte, non solo "probabilmente inutili":
- creazione bucket: già gestita idempotentemente da `S3Provider.init()`, con una lista bucket più corretta di quella di `minio-init` (include `collection-row-pictures-revisions`, che `minio-init` non creava);
- policy pubblica: `storageUrl.ts` instrada sempre il provider `s3` tramite il proxy autenticato — nessun caller usa mai un URL pubblico diretto (`getPublicUrl()` non ha chiamanti a runtime per il provider S3);
- bucket `temp-*` + regole ILM: architettura superata, nessun codice attuale scrive più su bucket `temp-*` — il cleanup reale (`setupTempFileCleanup()`, righe `FileObject` con `confirmedAt: null`) opera sui bucket reali.

SeaweedFS non ha un equivalente diretto di `mc`; dato che nessuna delle tre funzioni serve più, non è stato scritto un sostituto.

### 4. Script di migrazione unico, non uno per vendor

`apps/api/scripts/migrate-storage.ts` sostituisce il precedente `migrate-storage-to-minio.ts` (hardcoded local→MinIO). Un solo script parametrizzato su `--from`/`--to` (`local`/`s3`), con override `--from-s3-*`/`--to-s3-*` per costruire un provider S3 ad-hoc da credenziali CLI — necessario per il caso reale (MinIO esistente → nuova istanza SeaweedFS, nessuna delle due necessariamente quella puntata da AppConfig al momento della migrazione). Stesso script gestisce anche `local→s3` per chi parte da zero. Flag opzionale `--fix-mime` corregge Content-Type generici sia sul record `FileObject` (Postgres) sia sui metadati dell'oggetto S3 di destinazione — il vecchio script correggeva solo il secondo, lasciando la route di download by-id a servire comunque l'header sbagliato.

## Non fatto

- `docs/decisions/007-storage-layer-refactor.md` non è stato riscritto: è un record storico di cosa fu deciso in quel momento (già marcato "Potentially stale — review needed"), non un documento vivo.
- Object Lock/retention WORM su SeaweedFS non è verificato in questo progetto — vedi [docs/storage-immutable-bucket.md](../storage-immutable-bucket.md).
