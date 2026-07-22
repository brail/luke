/**
 * @luke/core/storage — Type definitions for the storage system.
 * Defines `IStorageProvider` and all associated param/result interfaces.
 * Implementations include local filesystem and MinIO; extensible to SAMBA, GDrive, etc.
 */

/**
 * Bucket logici per organizzare i file
 * - uploads: File caricati dagli utenti
 * - exports: File esportati dal sistema
 * - assets: Asset statici e risorse
 * - brand-logos: Logo dei brand (pending + confirmed)
 * - collection-row-pictures: Foto righe collection layout
 * - collection-row-pictures-revisions: Foto righe — bucket immutabile per registro qualità
 * - merchandising-specsheet-images: Immagini specsheet
 * - backups: Archivi di backup cifrati (privato, mai esposto tramite il proxy pubblico /uploads/:bucket/*)
 */
export type StorageBucket =
  | 'uploads'
  | 'exports'
  | 'assets'
  | 'brand-logos'
  | 'collection-row-pictures'
  | 'collection-row-pictures-revisions'
  | 'merchandising-specsheet-images'
  | 'company-assets'
  | 'backups';

/**
 * Buckets that hold real application files, as opposed to `backups` (internal/private).
 * Used by the backup engine to enumerate "all files" for a DB_AND_FILES backup — deliberately
 * excludes `backups` itself so a backup never recursively embeds prior backup blobs. Also the
 * single source of truth for "which buckets are user/upload-facing" — `z.enum(APP_STORAGE_BUCKETS)`
 * needs the literal tuple shape (not just `readonly StorageBucket[]`), hence the `as const satisfies`.
 */
export const APP_STORAGE_BUCKETS = [
  'uploads',
  'exports',
  'assets',
  'brand-logos',
  'collection-row-pictures',
  'collection-row-pictures-revisions',
  'merchandising-specsheet-images',
  'company-assets',
] as const satisfies readonly StorageBucket[];

/**
 * Metadati di un file memorizzato
 */
export interface StoredObjectMeta {
  /** ID univoco del file */
  id: string;
  /** Bucket di appartenenza */
  bucket: StorageBucket;
  /** Chiave interna (path logico generato server-side) */
  key: string;
  /** Nome originale del file */
  originalName: string;
  /** Dimensione in bytes */
  size: number;
  /** MIME type */
  contentType: string;
  /** Checksum SHA-256 (hex) */
  checksumSha256: string;
  /** ID utente che ha creato il file */
  createdBy: string;
  /** Data di creazione */
  createdAt: Date;
}

/**
 * Parametri per upload di un file
 */
export interface StoragePutParams {
  /** Bucket destinazione */
  bucket: StorageBucket;
  /** Nome originale del file */
  originalName: string;
  /** MIME type (default: application/octet-stream) */
  contentType: string;
  /** Dimensione attesa in bytes */
  size: number;
  /** Stream del file da scrivere */
  stream: NodeJS.ReadableStream;
  /** Chiave esplicita da usare al posto di quella auto-generata (es. per accoppiare blob e sidecar). Opzionale — se assente, il provider genera una chiave date-partitioned. */
  key?: string;
  /** Se true, salta il limite `maxFileSizeMB` del provider locale. Riservato a scritture interne privilegiate (es. backup engine) — mai da esporre a upload lato utente. */
  bypassSizeLimit?: boolean;
}

/**
 * Parametri per recupero di un file
 */
export interface StorageGetParams {
  /** Bucket sorgente */
  bucket: StorageBucket;
  /** Chiave del file */
  key: string;
}

/**
 * Parametri per cancellazione di un file
 */
export interface StorageDeleteParams {
  /** Bucket sorgente */
  bucket: StorageBucket;
  /** Chiave del file */
  key: string;
}

/**
 * Parametri per listing dei file
 */
export interface StorageListParams {
  /** Bucket da listare */
  bucket: StorageBucket;
  /** Prefisso per filtrare (es. '2025/10/') */
  prefix?: string;
  /** Cursore per paginazione */
  cursor?: string;
  /** Limite risultati (default: 100) */
  limit?: number;
}

/**
 * Risultato di un'operazione put
 */
export interface StoragePutResult {
  /** Chiave assegnata al file */
  key: string;
  /** Checksum SHA-256 calcolato */
  checksumSha256: string;
  /** Dimensione effettiva scritta */
  size: number;
}

/**
 * Risultato di un'operazione get
 */
export interface StorageGetResult {
  /** Stream del file */
  stream: NodeJS.ReadableStream;
  /** Dimensione del file */
  size: number;
  /** MIME type */
  contentType: string;
}

/**
 * Item nel risultato di un list
 */
export interface StorageListItem {
  /** Chiave del file */
  key: string;
  /** Dimensione in bytes */
  size: number;
  /** Data ultima modifica */
  modifiedAt: Date;
}

/**
 * Risultato di un'operazione list
 */
export interface StorageListResult {
  /** Array di file trovati */
  items: StorageListItem[];
  /** Cursore per la pagina successiva (opzionale) */
  nextCursor?: string;
}

/**
 * Capabilities advertised by a storage provider.
 * Use before calling optional methods to avoid runtime errors.
 */
export interface IStorageCapabilities {
  /** Provider can generate presigned PUT URLs for direct client upload */
  supportsPresignedUpload: boolean;
  /** Provider can generate presigned GET URLs for direct client download */
  supportsPresignedDownload: boolean;
}

/** Parameters for generating a presigned PUT URL */
export interface PresignedPutParams {
  bucket: StorageBucket;
  key: string;
  contentType: string;
  size: number;
  /** TTL in seconds */
  expiresIn?: number;
}

/** Result of a presigned PUT URL generation */
export interface PresignedPutResult {
  /** The presigned URL the client should PUT to */
  url: string;
  /** The key that will be used to store the file */
  key: string;
  /** When the URL expires */
  expiresAt: Date;
}

/** Parameters for generating a presigned GET URL */
export interface PresignedGetParams {
  bucket: StorageBucket;
  key: string;
  /** TTL in seconds */
  expiresIn?: number;
}

/** Result of a presigned GET URL generation */
export interface PresignedGetResult {
  url: string;
  expiresAt: Date;
}

/**
 * Unified storage provider interface for all concrete implementations (LocalFs, MinIO, etc.).
 * Implementations must be registered via the storage service — never instantiated directly by callers.
 *
 * Check `capabilities` before calling optional methods (`getPresignedPutUrl`, `getPresignedGetUrl`).
 */
export interface IStorageProvider {
  /** Capabilities advertised by this provider */
  readonly capabilities: IStorageCapabilities;

  put(params: StoragePutParams): Promise<StoragePutResult>;
  get(params: StorageGetParams): Promise<StorageGetResult>;
  delete(params: StorageDeleteParams): Promise<void>;
  list(params: StorageListParams): Promise<StorageListResult>;

  /** Only present when capabilities.supportsPresignedUpload === true */
  getPresignedPutUrl?(params: PresignedPutParams): Promise<PresignedPutResult>;
  /** Only present when capabilities.supportsPresignedDownload === true */
  getPresignedGetUrl?(params: PresignedGetParams): Promise<PresignedGetResult>;
  /** One-time setup: ensure required buckets exist (idempotent) */
  init?(): Promise<void>;
}
