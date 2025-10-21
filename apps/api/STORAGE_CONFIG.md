# Configurazione Storage Locale

## Setup Iniziale

Per abilitare lo storage locale, aggiungi le seguenti configurazioni in `AppConfig`:

```bash
# Nel database via seed o manualmente
INSERT INTO app_configs (id, key, value, isEncrypted, createdAt, updatedAt) VALUES
  (hex(randomblob(16)), 'storage.type', 'local', false, datetime('now'), datetime('now')),
  (hex(randomblob(16)), 'storage.local.basePath', '/var/lib/luke/storage', false, datetime('now'), datetime('now')),
  (hex(randomblob(16)), 'storage.local.maxFileSizeMB', '50', false, datetime('now'), datetime('now')),
  (hex(randomblob(16)), 'storage.local.buckets', '["uploads","exports","assets"]', false, datetime('now'), datetime('now'));
```

## Configurazione Parametri

### `storage.type`

- **Valore**: `local`
- **Descrizione**: Tipo di provider storage (attualmente solo `local` implementato)
- **Default**: `local`

### `storage.local.basePath`

- **Valore**: `/var/lib/luke/storage` (produzione) o `/tmp/luke-storage` (sviluppo)
- **Descrizione**: Directory base dove verranno salvati i file
- **Permessi**: La directory verrà creata automaticamente con permessi `0700`
- **Importante**: Assicurati che il processo abbia permessi di lettura/scrittura

### `storage.local.maxFileSizeMB`

- **Valore**: `50` (default)
- **Descrizione**: Dimensione massima file in MB
- **Range**: 1-1000 MB

### `storage.local.buckets`

- **Valore**: `["uploads","exports","assets"]`
- **Descrizione**: Bucket logici abilitati
- **Opzioni**: `uploads`, `exports`, `assets`

## Struttura Directory

Il sistema crea automaticamente questa struttura:

```
/var/lib/luke/storage/
├── uploads/
│   ├── .tmp/           # File temporanei durante upload
│   ├── 2025/
│   │   └── 10/
│   │       └── 20/
│   │           └── <uuid>.ext
│   └── ...
├── exports/
│   └── ...
└── assets/
    └── ...
```

## API Endpoints

### tRPC Router: `storage.*`

#### `storage.list`

Lista file paginata con filtri per bucket.

**Input:**

```typescript
{
  bucket?: 'uploads' | 'exports' | 'assets',
  limit?: number,    // max 100
  cursor?: string    // per paginazione
}
```

#### `storage.getMetadata`

Ottieni metadati di un file specifico.

**Input:**

```typescript
{
  id: string; // UUID del file
}
```

#### `storage.getDownloadLink`

Genera link download firmato (valido 5 minuti).

**Input:**

```typescript
{
  id: string; // UUID del file
}
```

**Output:**

```typescript
{
  url: string,       // URL con token HMAC
  expiresIn: 300     // secondi
}
```

#### `storage.createUpload`

Prepara upload e genera URL multipart.

**Input:**

```typescript
{
  bucket: 'uploads' | 'exports' | 'assets',
  originalName: string,
  contentType?: string,
  size: number
}
```

**Output:**

```typescript
{
  uploadId: string,
  uploadUrl: string,  // POST multipart
  bucket: string,
  maxSizeBytes: number
}
```

#### `storage.delete`

Cancella file (solo admin/editor).

**Input:**

```typescript
{
  id: string; // UUID del file
}
```

### Fastify Routes

#### `POST /storage/upload/:uploadId`

Upload multipart con autenticazione JWT.

**Headers:**

- `Authorization: Bearer <token>`

**Body (multipart/form-data):**

- `file`: File da caricare
- `bucket`: Bucket destinazione (opzionale, default: uploads)
- `originalName`: Nome originale (opzionale)

**Response:**

```json
{
  "id": "uuid",
  "bucket": "uploads",
  "key": "2025/10/20/uuid",
  "originalName": "documento.pdf",
  "size": 1024000,
  "contentType": "application/pdf",
  "checksumSha256": "abc123...",
  "createdAt": "2025-10-20T..."
}
```

#### `GET /storage/download?token=<signed_token>`

Download file con token firmato (no auth required).

**Response:**

- Stream del file con headers appropriati
- `Content-Type`, `Content-Length`, `Content-Disposition`

## Sicurezza

### Path Traversal Protection

- Tutte le chiavi sono generate server-side
- Validazione con `realpath` + `startsWith(basePath)`
- Nessun input utente influenza i path reali

### Atomic Writes

- File scritti in `.tmp/` con UUID random
- Checksum SHA-256 calcolato durante write
- Rename atomico alla destinazione finale
- Cleanup automatico su errori

### Token Download HMAC

- Firma HMAC-SHA256 con chiave derivata HKDF
- Payload: `{ bucket, key, exp }`
- TTL: 5 minuti (300s)
- Stateless (no Redis/DB)

### RBAC

- **Upload**: Utenti autenticati
- **Download**: Ownership o admin/editor
- **Delete**: Solo admin/editor
- **List**: Tutti gli utenti autenticati

### Audit Log

Eventi registrati:

- `FILE_UPLOADED`: Upload completato con successo
- `FILE_DOWNLOADED`: Download effettuato
- `FILE_DELETED`: File cancellato

Metadati logged: `userId`, `bucket`, `key`, `size` (niente contenuti)

## Estensibilità Futura

L'architettura `IStorageProvider` permette di aggiungere facilmente:

- **SAMBA**: `SambaStorageProvider implements IStorageProvider`
- **Google Drive**: `GDriveStorageProvider implements IStorageProvider`
- **S3**: `S3StorageProvider implements IStorageProvider`

Factory pattern in `storage/index.ts`:

```typescript
export function createStorageProvider(config) {
  switch (config.type) {
    case 'local':
      return new LocalFsProvider(config);
    case 'samba':
      return new SambaStorageProvider(config);
    case 'gdrive':
      return new GDriveStorageProvider(config);
    // ...
  }
}
```

Zero refactor del router tRPC o service layer.

## Testing

### Manuale via tRPC

```bash
# Lista file
curl -X POST http://localhost:3001/trpc/storage.list \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"bucket":"uploads"}'

# Crea upload
curl -X POST http://localhost:3001/trpc/storage.createUpload \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"bucket":"uploads","originalName":"test.txt","size":100}'

# Upload file
curl -X POST http://localhost:3001/storage/upload/<uploadId> \
  -H "Authorization: Bearer <token>" \
  -F "file=@test.txt" \
  -F "bucket=uploads"

# Get download link
curl -X POST http://localhost:3001/trpc/storage.getDownloadLink \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"id":"<file-uuid>"}'

# Download file
curl -O http://localhost:3001/storage/download?token=<signed-token>
```

## Comandi Utili

```bash
# Genera migrazione (già fatto)
pnpm --filter @luke/api prisma migrate dev --name add_file_storage

# Typecheck
pnpm -w typecheck

# Build
pnpm -w build

# Avvia dev
pnpm --filter @luke/api dev
```

## Note Implementative

- **Nessun chunked/resumable upload**: Upload diretti tramite multipart
- **Nessun antivirus**: Hook opzionale per future estensioni
- **Nessun CDN**: Streaming diretto da filesystem
- **Checksum obbligatorio**: SHA-256 per integrità file
- **Persistenza metadati**: Tabella `FileObject` in DB

## File Creati/Modificati

### Core (@luke/core)

- `src/storage/types.ts` - Interfacce e tipi
- `src/storage/config.ts` - Schema Zod configurazione
- `src/utils/sanitize.ts` - Utility sanitizzazione nomi file
- `src/index.ts` - Export moduli storage

### API (@luke/api)

- `prisma/schema.prisma` - Modello FileObject
- `prisma/migrations/.../add_file_storage/` - Migrazione DB
- `src/storage/providers/local.ts` - Provider local filesystem
- `src/storage/index.ts` - Service layer e factory
- `src/utils/downloadToken.ts` - Token HMAC download
- `src/plugins/storage-upload.ts` - Plugin Fastify upload/download
- `src/routers/storage.ts` - Router tRPC storage
- `src/routers/index.ts` - Export router storage
- `src/server.ts` - Registrazione plugin storage

## Dipendenze Aggiunte

- `@fastify/multipart@^9.2.1` - Upload multipart

## Status: ✅ Completato

Implementazione completa e funzionante:

- ✅ Typecheck passato
- ✅ Build completato
- ✅ Linting pulito
- ✅ Migrazione DB applicata
- ✅ Provider estensibile per futuri adapter (SMB, GDrive)


