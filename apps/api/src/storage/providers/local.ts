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
    // Ottieni realpath del basePath
    try {
      await mkdir(this.basePath, { recursive: true, mode: 0o700 });
      this.realBasePath = await realpath(this.basePath);
    } catch (error) {
      throw new Error(
        `Impossibile inizializzare basePath: ${error instanceof Error ? error.message : 'Unknown'}`
      );
    }

    // Crea directory per ogni bucket
    for (const bucket of this.buckets) {
      const bucketPath = join(this.basePath, bucket);
      await mkdir(bucketPath, { recursive: true, mode: 0o700 });

      // Crea directory .tmp per atomic writes
      const tmpPath = join(bucketPath, '.tmp');
      await mkdir(tmpPath, { recursive: true, mode: 0o700 });
    }

    // Crea esplicitamente directory brand-logos se manca
    const brandLogosPath = join(this.basePath, 'brand-logos');
    try {
      await mkdir(brandLogosPath, { recursive: true, mode: 0o700 });
      const brandLogosTmpPath = join(brandLogosPath, '.tmp');
      await mkdir(brandLogosTmpPath, { recursive: true, mode: 0o700 });
    } catch (error) {
      // Log ma non fallire se già esiste
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

    // Pre-check con isPathSafe (blocca ../ e path assoluti)
    if (!isPathSafe(candidateSubpath)) {
      throw new Error('Path non sicuro: caratteri invalidi o traversal');
    }

    // Canonicalizza base (già fatto in init, ma per sicurezza)
    const baseReal = this.realBasePath;

    // Resolve target assoluto
    const targetAbs = resolve(baseReal, candidateSubpath);

    // Canonicalizza directory parent (sync per evitare race)
    const dirAbs = dirname(targetAbs);
    let dirReal: string;

    try {
      // Usa realpathSync.native per risolvere symlink
      dirReal = realpathSync.native(dirAbs);
    } catch {
      // Directory non esiste ancora - verifica con resolve
      dirReal = resolve(dirAbs);
    }

    // Ricostruisci path finale canonico
    const finalAbs = join(dirReal, basename(targetAbs));

    // Verifica con path.relative (sicuro se relativo e non contiene ..)
    const rel = relative(baseReal, finalAbs);

    if (isAbsolute(rel) || rel.startsWith('..')) {
      throw new Error('Path traversal rilevato');
    }

    // Ritorna path finale canonico per evitare ulteriori normalize
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

    // Aggiungi estensione basata sul content-type
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

    // Crea directory parent se non esiste
    await mkdir(dirname(targetPath), { recursive: true, mode: 0o700 });

    const writeStream = createWriteStream(targetPath, { mode: 0o600 });

    return new Promise((resolve, reject) => {
      stream.on('data', (chunk: Buffer) => {
        bytesWritten += chunk.length;

        // Verifica limite dimensione (se applicabile)
        if (maxSize !== null && bytesWritten > maxSize) {
          // Chiudi gli stream
          if (typeof (stream as any).destroy === 'function') {
            (stream as any).destroy();
          }
          writeStream.destroy();
          reject(new Error(`File troppo grande (max ${maxSize} bytes)`));
        }
      });

      stream.on('error', error => {
        writeStream.destroy();
        reject(error);
      });

      writeStream.on('error', error => {
        if (typeof (stream as any).destroy === 'function') {
          (stream as any).destroy();
        }
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
    // Usa la chiave fornita dal chiamante, se presente; altrimenti genera server-side con estensione
    const key = params.key ?? this.generateKey(params.contentType);

    // Path finale e temporaneo
    const finalPath = join(params.bucket, key);
    const tmpFileName = `${randomUUID()}.part`;
    const tmpPath = join(params.bucket, '.tmp', tmpFileName);

    // Valida e ottieni path canonici
    const absFinalPath = this.validatePathSafety(finalPath);
    const absTmpPath = this.validatePathSafety(tmpPath);

    try {
      // Crea directory parent per tmp
      await mkdir(dirname(absTmpPath), { recursive: true, mode: 0o700 });

      // Scrivi su file temporaneo
      const size = await this.writeStreamToFile(
        params.stream,
        absTmpPath,
        params.bypassSizeLimit ? null : this.maxFileSizeBytes
      );

      // Calcola checksum
      const checksumSha256 = await this.calculateChecksum(absTmpPath);

      // Crea directory finale
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
        // Best-effort cleanup, ignora se il file temp non esiste già
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

      // Determina content type (default: application/octet-stream)
      // Per ora semplice, potrebbe essere esteso con mime detection
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
      // Se file non esiste, consideriamo l'operazione riuscita (idempotente)
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

    // Valida path safety e ottieni path canonico del bucket
    const bucketPath = this.validatePathSafety(params.bucket);

    const items: StorageListResult['items'] = [];

    // Scandisce ricorsivamente la directory
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
            // Ricorsione nelle sottodirectory
            await scanDir(join(dirPath, entry.name), entryRelPath);
          } else if (entry.isFile()) {
            // Filtra per prefisso
            if (!entryRelPath.startsWith(prefix)) {
              continue;
            }

            // Ottieni stats
            const stats = await stat(join(dirPath, entry.name));

            items.push({
              key: entryRelPath,
              size: stats.size,
              modifiedAt: stats.mtime,
            });

            // Limita risultati
            if (items.length >= limit) {
              return;
            }
          }
        }
      } catch (error) {
        // Se directory non esiste, ritorna array vuoto
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          return;
        }
        throw error;
      }
    }

    await scanDir(bucketPath);

    // Ordina per key (lexicographic)
    items.sort((a, b) => a.key.localeCompare(b.key));

    // Paginazione cursor-based
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
