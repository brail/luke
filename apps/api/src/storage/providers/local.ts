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
import { join, dirname, resolve, basename, relative, isAbsolute } from 'path';
import { pipeline } from 'stream/promises';

import pino from 'pino';

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
import { isPathSafe } from '@luke/core';

const logger = pino({ level: 'info' });

/**
 * `NodeJS.ReadableStream` doesn't declare `.destroy()` (it's specific to the
 * more concrete `stream.Readable`) — narrows structurally instead of casting.
 */
function tryDestroyStream(stream: NodeJS.ReadableStream): void {
  const maybeDestroyable = stream as unknown as { destroy?: unknown };
  if (typeof maybeDestroyable.destroy === 'function') {
    (maybeDestroyable.destroy as () => void)();
  }
}

/** Local filesystem storage provider. Implements IStorageProvider over a configurable base directory. */
export class LocalFsProvider implements IStorageProvider {
  readonly capabilities: IStorageCapabilities = {
    supportsPresignedUpload: false,
    supportsPresignedDownload: false,
  };

  private basePath: string;
  private maxFileSizeBytes: number;
  private buckets: string[];
  private realBasePath?: string;

  constructor(config: LocalStorageConfig) {
    this.basePath = config.basePath;
    this.maxFileSizeBytes = config.maxFileSizeMB * 1024 * 1024;
    this.buckets = config.buckets;
  }

  /**
   * Initializes the provider by creating the base directory and one subdirectory per configured bucket.
   * Each bucket also gets a `.tmp` subdirectory used for atomic writes.
   */
  async init(): Promise<void> {
    // Get the realpath of basePath
    try {
      await mkdir(this.basePath, { recursive: true, mode: 0o700 });
      this.realBasePath = await realpath(this.basePath);
    } catch (error) {
      throw new Error(
        `Impossibile inizializzare basePath: ${error instanceof Error ? error.message : 'Unknown'}`
      );
    }

    // Create directory for each bucket
    for (const bucket of this.buckets) {
      const bucketPath = join(this.basePath, bucket);
      await mkdir(bucketPath, { recursive: true, mode: 0o700 });

      // Create .tmp directory for atomic writes
      const tmpPath = join(bucketPath, '.tmp');
      await mkdir(tmpPath, { recursive: true, mode: 0o700 });
    }

    // Explicitly create brand-logos directory if missing
    const brandLogosPath = join(this.basePath, 'brand-logos');
    try {
      await mkdir(brandLogosPath, { recursive: true, mode: 0o700 });
      const brandLogosTmpPath = join(brandLogosPath, '.tmp');
      await mkdir(brandLogosTmpPath, { recursive: true, mode: 0o700 });
    } catch (error) {
      // Log but don't fail if it already exists
      logger.warn({ err: error }, 'Directory brand-logos creation warning');
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
      throw new Error('Path non sicuro: caratteri invalidi o traversal');
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

  /**
   * Generates a server-side storage key with date-based path partitioning: `YYYY/MM/DD/<uuid>[.ext]`.
   */
  private generateKey(contentType?: string): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const uuid = randomUUID();

    // Add extension based on content-type
    const extension = this.getExtensionFromContentType(contentType);
    return `${year}/${month}/${day}/${uuid}${extension}`;
  }

  /** Returns the file extension for a given MIME type, or an empty string if unknown. */
  private getExtensionFromContentType(contentType?: string): string {
    if (!contentType) return '';
    
    switch (contentType) {
      case 'image/png':
        return '.png';
      case 'image/jpeg':
      case 'image/jpg':
        return '.jpg';
      case 'image/webp':
        return '.webp';
      default:
        return '';
    }
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

    const writeStream = createWriteStream(targetPath, { mode: 0o600 });

    return new Promise((resolve, reject) => {
      stream.on('data', (chunk: Buffer) => {
        bytesWritten += chunk.length;

        // Check size limit (if applicable)
        if (maxSize !== null && bytesWritten > maxSize) {
          // Close the streams
          tryDestroyStream(stream);
          writeStream.destroy();
          reject(new Error(`File troppo grande (max ${maxSize} bytes)`));
        }
      });

      stream.on('error', error => {
        writeStream.destroy();
        reject(error);
      });

      writeStream.on('error', error => {
        tryDestroyStream(stream);
        reject(error);
      });

      writeStream.on('finish', () => {
        resolve(bytesWritten);
      });

      stream.pipe(writeStream);
    });
  }

  /**
   * Stores a file in the local filesystem using an atomic write (temp file → rename).
   *
   * @returns The (generated or caller-supplied via `params.key`) key, SHA-256 checksum, and final byte size.
   */
  async put(params: StoragePutParams): Promise<StoragePutResult> {
    // Use the caller-supplied key, if present; otherwise generate server-side with an extension
    const key = params.key ?? this.generateKey(params.contentType);

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
        `Errore upload file: ${error instanceof Error ? error.message : 'Unknown'}`
      );
    }
  }

  /**
   * Opens a readable stream for a stored file.
   *
   * @returns A stream, the file size, and a default content type (`application/octet-stream`).
   * @throws If the path does not exist or is not a regular file.
   */
  async get(params: StorageGetParams): Promise<StorageGetResult> {
    const filePath = join(params.bucket, params.key);
    const absPath = this.validatePathSafety(filePath);

    try {
      const stats = await stat(absPath);
      if (!stats.isFile()) {
        throw new Error('Path non è un file');
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
      throw new Error(
        `File non trovato: ${error instanceof Error ? error.message : 'Unknown'}`
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
          `Errore cancellazione file: ${error instanceof Error ? error.message : 'Unknown'}`
        );
      }
    }
  }

  /**
   * Lists files in a bucket with optional prefix filtering and cursor-based pagination.
   *
   * @returns Lexicographically sorted items and an optional cursor for the next page.
   */
  async list(params: StorageListParams): Promise<StorageListResult> {
    const prefix = params.prefix || '';
    const limit = params.limit || 100;

    // Validate path safety and get the bucket's canonical path
    const bucketPath = this.validatePathSafety(params.bucket);

    const items: StorageListResult['items'] = [];

    // Recursively scans the directory
    async function scanDir(
      dirPath: string,
      relativePath: string = ''
    ): Promise<void> {
      try {
        const entries = await readdir(dirPath, { withFileTypes: true });

        for (const entry of entries) {
          // Skip directory .tmp
          if (entry.name === '.tmp') {
            continue;
          }

          const entryRelPath = join(relativePath, entry.name);

          if (entry.isDirectory()) {
            // Recurse into subdirectories
            await scanDir(join(dirPath, entry.name), entryRelPath);
          } else if (entry.isFile()) {
            // Filter by prefix
            if (!entryRelPath.startsWith(prefix)) {
              continue;
            }

            // Get stats
            const stats = await stat(join(dirPath, entry.name));

            items.push({
              key: entryRelPath,
              size: stats.size,
              modifiedAt: stats.mtime,
            });

            // Limit results
            if (items.length >= limit) {
              return;
            }
          }
        }
      } catch (error) {
        // If the directory doesn't exist, return an empty array
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          return;
        }
        throw error;
      }
    }

    await scanDir(bucketPath);

    // Sort by key (lexicographic)
    items.sort((a, b) => a.key.localeCompare(b.key));

    // Cursor-based pagination
    let startIndex = 0;
    if (params.cursor) {
      startIndex = items.findIndex(item => item.key > params.cursor!);
      if (startIndex === -1) {
        startIndex = items.length;
      }
    }

    const paginatedItems = items.slice(startIndex, startIndex + limit);
    const hasMore = items.length > startIndex + limit;

    return {
      items: paginatedItems,
      nextCursor: hasMore
        ? paginatedItems[paginatedItems.length - 1]?.key
        : undefined,
    };
  }
}
