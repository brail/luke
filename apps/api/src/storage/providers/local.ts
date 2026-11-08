/**
 * Local filesystem implementation of IStorageProvider.
 *
 * Security measures applied:
 * - Path traversal protection via `realpath` + relative-path check
 * - Atomic writes: file written to a `.tmp` directory, then renamed to its final path
 * - Configurable per-file size limit (default 50 MB)
 * - Directory permissions set to 0700, file permissions to 0600
 * - SHA-256 checksum computed after write and returned in the result
 */

import { createHash, randomUUID } from 'crypto';
import { createReadStream, createWriteStream, realpathSync } from 'fs';
import { readdir, mkdir, unlink, stat, realpath } from 'fs/promises';
import { join, dirname, resolve, basename, relative, isAbsolute, sep } from 'path';
import { Transform, type TransformCallback } from 'stream';
import { pipeline } from 'stream/promises';

import type {
  IStorageCapabilities,
  IStorageProvider,
  StoragePutParams,
  StoragePutResult,
  StorageGetParams,
  StorageGetResult,
  StorageDeleteParams,
  StorageListParams,
  StorageListResult,
  LocalStorageConfig,
} from '@luke/core';
import { APP_STORAGE_BUCKETS, StorageObjectNotFoundError, isPathSafe } from '@luke/core';

import { toErrorMessage } from '../../lib/error';
import { generateStorageKey } from '../keys';

/** Local filesystem storage provider. Implements IStorageProvider over a configurable base directory. */
export class LocalFsProvider implements IStorageProvider {
  readonly capabilities: IStorageCapabilities = {
    supportsPresignedUpload: false,
    supportsPresignedDownload: false,
    supportsContentTypeFix: false,
  };

  private basePath: string;
  private maxFileSizeBytes: number;
  private realBasePath?: string;

  constructor(config: LocalStorageConfig) {
    this.basePath = config.basePath;
    this.maxFileSizeBytes = config.maxFileSizeMB * 1024 * 1024;
  }

  /**
   * Initializes the provider by creating the base directory and one subdirectory per application
   * bucket, each with the `.tmp` subdirectory used for atomic writes.
   *
   * Pre-creation is a convenience, not a precondition: `put` creates the directory it needs anyway.
   * The set is `APP_STORAGE_BUCKETS` rather than a configured list — nothing chose a subset, and a
   * second spelling of the list only gave the two a chance to disagree.
   */
  async init(): Promise<void> {
    // Get the realpath of basePath
    try {
      await mkdir(this.basePath, { recursive: true, mode: 0o700 });
      this.realBasePath = await realpath(this.basePath);
    } catch (error) {
      throw new Error(
        `Impossibile inizializzare basePath: ${toErrorMessage(error)}`,
        { cause: error }
      );
    }

    // Create directory for each bucket
    for (const bucket of APP_STORAGE_BUCKETS) {
      const bucketPath = join(this.basePath, bucket);
      await mkdir(bucketPath, { recursive: true, mode: 0o700 });

      // Create .tmp directory for atomic writes
      const tmpPath = join(bucketPath, '.tmp');
      await mkdir(tmpPath, { recursive: true, mode: 0o700 });
    }
  }

  /**
   * Validates a relative subpath against traversal attacks and returns its canonical absolute path.
   *
   * @returns Canonical absolute path within the base directory.
   * @throws If the path contains traversal sequences or resolves outside the base directory.
   */
  private validatePathSafety(candidateSubpath: string): string {
    if (!this.realBasePath) {
      throw new Error('Provider non inizializzato');
    }

    // Pre-check with isPathSafe (blocks ../ and absolute paths)
    if (!isPathSafe(candidateSubpath)) {
      throw new Error('Unsafe path: invalid characters or traversal');
    }

    // Canonicalize base (already done in init, but for safety)
    const baseReal = this.realBasePath;

    // Resolve absolute target
    const targetAbs = resolve(baseReal, candidateSubpath);

    // Canonicalize parent directory (sync to avoid a race)
    const dirAbs = dirname(targetAbs);
    let dirReal: string;

    try {
      // Use realpathSync.native to resolve symlinks
      dirReal = realpathSync.native(dirAbs);
    } catch {
      // Directory doesn't exist yet - verify with resolve
      dirReal = resolve(dirAbs);
    }

    // Rebuild the final canonical path
    const finalAbs = join(dirReal, basename(targetAbs));

    // Verify with path.relative (safe if relative and doesn't contain ..)
    const rel = relative(baseReal, finalAbs);

    if (isAbsolute(rel) || rel.startsWith('..')) {
      throw new Error('Path traversal rilevato');
    }

    // Return the final canonical path to avoid further normalize calls
    return finalAbs;
  }

  /** Computes the SHA-256 hex digest of the file at the given path. */
  private async calculateChecksum(filePath: string): Promise<string> {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);

    await pipeline(stream, hash);

    return hash.digest('hex');
  }

  /**
   * Pipes a readable stream to a file, optionally enforcing a maximum byte limit.
   *
   * @param maxSize - Byte limit, or `null` to skip the check entirely (privileged internal writes only).
   * @returns Number of bytes written.
   * @throws If the stream exceeds `maxSize` bytes.
   */
  private async writeStreamToFile(
    stream: NodeJS.ReadableStream,
    targetPath: string,
    maxSize: number | null
  ): Promise<number> {
    let bytesWritten = 0;

    // Create parent directory if it doesn't exist
    await mkdir(dirname(targetPath), { recursive: true, mode: 0o700 });

    // `pipeline` also rejects on a source that has already failed or closed, which the source's own
    // events would no longer report, and destroys every stream when one of them fails.
    await pipeline(
      stream,
      new Transform({
        transform(chunk: Buffer, _encoding, callback: TransformCallback) {
          bytesWritten += chunk.length;
          if (maxSize !== null && bytesWritten > maxSize) {
            callback(new Error(`File troppo grande (max ${maxSize} bytes)`));
          } else {
            callback(null, chunk);
          }
        },
      }),
      createWriteStream(targetPath, { mode: 0o600 })
    );
    return bytesWritten;
  }

  /**
   * Stores a file in the local filesystem using an atomic write (temp file → rename).
   *
   * @returns The (generated or caller-supplied via `params.key`) key, SHA-256 checksum, and final byte size.
   */
  async put(params: StoragePutParams): Promise<StoragePutResult> {
    // Use the caller-supplied key, if present; otherwise generate server-side with an extension
    const key = params.key ?? generateStorageKey(params.contentType);

    // Final and temporary paths
    const finalPath = join(params.bucket, key);
    const tmpFileName = `${randomUUID()}.part`;
    const tmpPath = join(params.bucket, '.tmp', tmpFileName);

    // Validate and get canonical paths
    const absFinalPath = this.validatePathSafety(finalPath);
    const absTmpPath = this.validatePathSafety(tmpPath);

    try {
      // Create parent directory for tmp
      await mkdir(dirname(absTmpPath), { recursive: true, mode: 0o700 });

      // Write to temp file
      const size = await this.writeStreamToFile(
        params.stream,
        absTmpPath,
        params.bypassSizeLimit ? null : this.maxFileSizeBytes
      );

      // Calculate checksum
      const checksumSha256 = await this.calculateChecksum(absTmpPath);

      // Create final directory
      await mkdir(dirname(absFinalPath), { recursive: true, mode: 0o700 });

      // Atomic rename
      const { rename } = await import('fs/promises');
      await rename(absTmpPath, absFinalPath);

      return {
        key,
        checksumSha256,
        size,
      };
    } catch (error) {
      // Cleanup
      try {
        await unlink(absTmpPath);
      } catch {
        // Best-effort cleanup, ignore if the temp file doesn't already exist
      }

      throw new Error(
        `File upload failed: ${toErrorMessage(error)}`,
        { cause: error }
      );
    }
  }

  /**
   * Opens a readable stream for a stored file.
   *
   * @returns A stream, the file size, and a default content type (`application/octet-stream`).
   * @throws {StorageObjectNotFoundError} If nothing exists at the path in an existing bucket
   *   directory; another error if the bucket directory is missing, or the path is not a regular file
   *   or cannot be read.
   */
  async get(params: StorageGetParams): Promise<StorageGetResult> {
    const filePath = join(params.bucket, params.key);
    const absPath = this.validatePathSafety(filePath);

    try {
      const stats = await stat(absPath);
      if (!stats.isFile()) {
        throw new Error('Path is not a file');
      }

      const stream = createReadStream(absPath);

      // Determine content type (default: application/octet-stream)
      // Simple for now, could be extended with mime detection
      const contentType = 'application/octet-stream';

      return {
        stream,
        size: stats.size,
        contentType,
      };
    } catch (error) {
      // `stat` rejects with a Node errno error. ENOENT means "no such object" only while the bucket
      // directory exists: without it the provider is looking in the wrong place.
      if (
        (error as NodeJS.ErrnoException).code === 'ENOENT' &&
        (await stat(this.validatePathSafety(params.bucket)).then(s => s.isDirectory(), () => false))
      ) {
        throw new StorageObjectNotFoundError(params.bucket, params.key, { cause: error });
      }
      throw new Error(
        `File read failed: ${toErrorMessage(error)}`,
        { cause: error }
      );
    }
  }

  /**
   * Deletes a stored file. If the file does not exist, the operation is treated as a success (idempotent).
   */
  async delete(params: StorageDeleteParams): Promise<void> {
    const filePath = join(params.bucket, params.key);
    const absPath = this.validatePathSafety(filePath);

    try {
      await unlink(absPath);
    } catch (error) {
      // If the file doesn't exist, we consider the operation successful (idempotent)
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new Error(
          `File deletion failed: ${toErrorMessage(error)}`,
          { cause: error }
        );
      }
    }
  }

  /**
   * Lists files in a bucket with optional prefix filtering and cursor-based pagination.
   *
   * The whole bucket is walked, then sorted by code unit — the order the cursor compares in — and
   * only the page is `stat`ed (#109). A path with a `.tmp` segment is an upload still being written.
   *
   * @returns Items sorted by key and, when more follow, the cursor for the next page.
   */
  async list(params: StorageListParams): Promise<StorageListResult> {
    const prefix = params.prefix || '';
    const limit = params.limit || 100;

    // Validate path safety and get the bucket's canonical path
    const bucketPath = this.validatePathSafety(params.bucket);

    // ponytail: every page walks the whole bucket; page through one walk if local buckets grow large.
    // Only a missing bucket is an empty one: a subdirectory removed mid-walk must not hide the rest.
    const entries = await readdir(bucketPath, { recursive: true, withFileTypes: true }).catch((error: unknown) => {
      const { code, path } = error as NodeJS.ErrnoException;
      if (code === 'ENOENT' && path === bucketPath) return [];
      throw error;
    });

    const cursor = params.cursor ?? '';
    const keys = entries
      .filter(entry => entry.isFile())
      .map(entry => relative(bucketPath, join(entry.parentPath, entry.name)))
      .filter(key => key.startsWith(prefix) && !key.split(sep).includes('.tmp'))
      // The default sort compares UTF-16 code units, as `>` does below.
      .sort();
    const after = keys.filter(key => key > cursor);
    const page = after.slice(0, limit);

    // A file deleted since the walk is left out, not a failure of the whole page.
    const listed = await Promise.all(
      page.map(async key => {
        const stats = await stat(join(bucketPath, key)).catch((error: unknown) => {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
          throw error;
        });
        return stats && { key, size: stats.size, modifiedAt: stats.mtime };
      })
    );
    const items = listed.filter(item => item !== null);

    return { items, nextCursor: after.length > limit ? page[page.length - 1] : undefined };
  }
}
