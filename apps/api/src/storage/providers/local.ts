/**
 * Local Filesystem Storage Provider
 *
 * Implementazione IStorageProvider per storage su filesystem locale
 *
 * Sicurezza:
 * - Path traversal protection (realpath + startsWith)
 * - Atomic writes (tmp + rename)
 * - Limiti dimensione file
 * - Permessi directory 0700
 * - Checksum SHA-256
 */

import { createHash, randomUUID } from 'crypto';
import { createReadStream, createWriteStream } from 'fs';
import { readdir, mkdir, unlink, stat, realpath } from 'fs/promises';
import { join, dirname, resolve } from 'path';
import { pipeline } from 'stream/promises';

import type {
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

/**
 * Local Filesystem Provider
 */
export class LocalFsProvider implements IStorageProvider {
  private basePath: string;
  private maxFileSizeBytes: number;
  private buckets: string[];
  private realBasePath?: string;

  constructor(config: LocalStorageConfig) {
    // Usa path.resolve per root assoluta
    this.basePath = resolve(config.basePath);
    this.maxFileSizeBytes = config.maxFileSizeMB * 1024 * 1024;
    this.buckets = config.buckets;
  }

  /**
   * Inizializza il provider creando directory bucket
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
      console.warn('Directory brand-logos creation warning:', error);
    }
  }

  /**
   * Valida path safety contro traversal attacks
   */
  private async validatePathSafety(targetPath: string): Promise<void> {
    if (!this.realBasePath) {
      throw new Error('Provider non inizializzato');
    }

    // Verifica path segment sicuro
    if (!isPathSafe(targetPath)) {
      throw new Error('Path non sicuro: caratteri invalidi o traversal');
    }

    // Resolve path completo
    const fullPath = resolve(this.basePath, targetPath);

    // Ottieni realpath della directory parent (il file potrebbe non esistere ancora)
    let realTargetDir: string;
    try {
      realTargetDir = await realpath(dirname(fullPath));
    } catch {
      // Directory non esiste ancora, è OK per PUT
      // Verifichiamo che il path risolto inizi con basePath
      const resolvedDir = resolve(dirname(fullPath));
      if (!resolvedDir.startsWith(this.realBasePath)) {
        throw new Error('Path traversal rilevato');
      }
      return;
    }

    // Verifica che il realpath inizi con realBasePath
    if (!realTargetDir.startsWith(this.realBasePath)) {
      throw new Error('Path traversal rilevato');
    }
  }

  /**
   * Genera chiave server-side con partizionamento temporale
   */
  private generateKey(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const uuid = randomUUID();

    return `${year}/${month}/${day}/${uuid}`;
  }

  /**
   * Calcola SHA-256 di un file
   */
  private async calculateChecksum(filePath: string): Promise<string> {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);

    await pipeline(stream, hash);

    return hash.digest('hex');
  }

  /**
   * Scrive stream su file con limite dimensione
   */
  private async writeStreamToFile(
    stream: NodeJS.ReadableStream,
    targetPath: string,
    maxSize: number
  ): Promise<number> {
    let bytesWritten = 0;

    // Crea directory parent se non esiste
    await mkdir(dirname(targetPath), { recursive: true, mode: 0o700 });

    const writeStream = createWriteStream(targetPath, { mode: 0o600 });

    return new Promise((resolve, reject) => {
      stream.on('data', (chunk: Buffer) => {
        bytesWritten += chunk.length;

        // Verifica limite dimensione
        if (bytesWritten > maxSize) {
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
   * Upload file nello storage
   */
  async put(params: StoragePutParams): Promise<StoragePutResult> {
    // Genera chiave server-side
    const key = this.generateKey();

    // Path finale e temporaneo
    const finalPath = join(params.bucket, key);
    const tmpFileName = `${randomUUID()}.part`;
    const tmpPath = join(params.bucket, '.tmp', tmpFileName);

    // Valida path safety
    await this.validatePathSafety(finalPath);
    await this.validatePathSafety(tmpPath);

    // Path assoluti
    const absTmpPath = join(this.basePath, tmpPath);
    const absFinalPath = join(this.basePath, finalPath);

    try {
      // Scrivi su file temporaneo
      const size = await this.writeStreamToFile(
        params.stream,
        absTmpPath,
        this.maxFileSizeBytes
      );

      // Calcola checksum
      const checksumSha256 = await this.calculateChecksum(absTmpPath);

      // Crea directory finale
      await mkdir(dirname(absFinalPath), { recursive: true, mode: 0o700 });

      // Atomic rename
      await realpath(absTmpPath); // Verifica che il file temp esista
      await mkdir(dirname(absFinalPath), { recursive: true, mode: 0o700 });

      // Rinomina atomicamente
      const { rename } = await import('fs/promises');
      await rename(absTmpPath, absFinalPath);

      return {
        key,
        checksumSha256,
        size,
      };
    } catch (error) {
      // Cleanup: rimuovi file temporaneo se esiste
      try {
        await unlink(absTmpPath);
      } catch {
        // Ignora errore cleanup
      }

      throw new Error(
        `Errore upload file: ${error instanceof Error ? error.message : 'Unknown'}`
      );
    }
  }

  /**
   * Download file dallo storage
   */
  async get(params: StorageGetParams): Promise<StorageGetResult> {
    const filePath = join(params.bucket, params.key);

    // Valida path safety
    await this.validatePathSafety(filePath);

    const absPath = join(this.basePath, filePath);

    // Verifica esistenza file
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
   * Cancella file dallo storage
   */
  async delete(params: StorageDeleteParams): Promise<void> {
    const filePath = join(params.bucket, params.key);

    // Valida path safety
    await this.validatePathSafety(filePath);

    const absPath = join(this.basePath, filePath);

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
   * Lista file in un bucket
   */
  async list(params: StorageListParams): Promise<StorageListResult> {
    const bucketPath = join(this.basePath, params.bucket);
    const prefix = params.prefix || '';
    const limit = params.limit || 100;

    // Valida path safety
    await this.validatePathSafety(params.bucket);

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
