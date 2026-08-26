/**
 * @luke/core/storage — Type definitions for the storage system.
 * Defines `IStorageProvider` and all associated param/result interfaces.
 * Implementations include local filesystem and S3-compatible providers (MinIO, SeaweedFS, ...);
 * extensible to SAMBA, GDrive, etc.
 */

/**
 * Logical buckets to organize files
 * - uploads: Files uploaded by users
 * - exports: Files exported by the system
 * - assets: Static assets and resources
 * - brand-logos: Brand logos (pending + confirmed)
 * - collection-row-pictures: Collection layout row photos
 * - collection-row-pictures-revisions: Row photos — immutable bucket for quality log
 * - merchandising-specsheet-images: Specsheet images
 * - backups: Encrypted backup archives (private, never exposed via public proxy /uploads/:bucket/*)
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
 * Metadata for a stored file
 */
export interface StoredObjectMeta {
  /** Unique file ID */
  id: string;
  /** Bucket membership */
  bucket: StorageBucket;
  /** Internal key (logical path generated server-side) */
  key: string;
  /** Original file name */
  originalName: string;
  /** Size in bytes */
  size: number;
  /** MIME type */
  contentType: string;
  /** SHA-256 checksum (hex) */
  checksumSha256: string;
  /** ID of user who created the file */
  createdBy: string;
  /** Creation date */
  createdAt: Date;
  /** Master this file is a derivative of. Absent/null on masters. */
  parentId?: string | null;
  /** Variant name (thumb | card | export). Absent/null on masters. */
  variant?: string | null;
  /** Pixel width, when known (image assets only). */
  width?: number | null;
  /** Pixel height, when known (image assets only). */
  height?: number | null;
}

/**
 * Parameters for uploading a file
 */
export interface StoragePutParams {
  /** Destination bucket */
  bucket: StorageBucket;
  /** Original file name */
  originalName: string;
  /** MIME type (default: application/octet-stream) */
  contentType: string;
  /** Expected size in bytes */
  size: number;
  /** File stream to write */
  stream: NodeJS.ReadableStream;
  /** Explicit key to use instead of auto-generated (e.g. to pair blob and sidecar). Optional — if absent, provider generates a date-partitioned key. */
  key?: string;
  /** If true, skips `maxFileSizeMB` limit of local provider. Reserved for privileged internal writes (e.g. backup engine) — never expose to user uploads. */
  bypassSizeLimit?: boolean;
}

/**
 * Parameters for retrieving a file
 */
export interface StorageGetParams {
  /** Source bucket */
  bucket: StorageBucket;
  /** File key */
  key: string;
}

/**
 * Parameters for deleting a file
 */
export interface StorageDeleteParams {
  /** Source bucket */
  bucket: StorageBucket;
  /** File key */
  key: string;
}

/**
 * Parameters for listing files
 */
export interface StorageListParams {
  /** Bucket to list */
  bucket: StorageBucket;
  /** Prefix to filter (e.g. '2025/10/') */
  prefix?: string;
  /** Cursor for pagination */
  cursor?: string;
  /** Result limit (default: 100) */
  limit?: number;
}

/**
 * Result of a put operation
 */
export interface StoragePutResult {
  /** Key assigned to the file */
  key: string;
  /** Calculated SHA-256 checksum */
  checksumSha256: string;
  /** Actual size written */
  size: number;
}

/**
 * Result of a get operation
 */
export interface StorageGetResult {
  /** File stream */
  stream: NodeJS.ReadableStream;
  /** File size */
  size: number;
  /** MIME type */
  contentType: string;
}

/**
 * Item in a list operation result
 */
export interface StorageListItem {
  /** File key */
  key: string;
  /** Size in bytes */
  size: number;
  /** Last modification date */
  modifiedAt: Date;
}

/**
 * Result of a list operation
 */
export interface StorageListResult {
  /** Array of found files */
  items: StorageListItem[];
  /** Cursor for next page (optional) */
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
  /** Provider can rewrite an existing object's Content-Type metadata in place, without re-transferring bytes */
  supportsContentTypeFix: boolean;
}

/** Parameters for rewriting an existing object's Content-Type metadata in place */
export interface StorageFixContentTypeParams {
  bucket: StorageBucket;
  key: string;
  contentType: string;
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
 * Unified storage provider interface for all concrete implementations (LocalFs, S3, etc.).
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
  /** Only present when capabilities.supportsContentTypeFix === true */
  fixContentType?(params: StorageFixContentTypeParams): Promise<void>;
  /** One-time setup: ensure required buckets exist (idempotent) */
  init?(): Promise<void>;
}
