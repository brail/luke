/**
 * Storage service layer — factory and high-level file management functions.
 *
 * Instantiates the active storage provider (local FS or S3-compatible) from AppConfig,
 * then exposes provider-agnostic operations that combine provider I/O with
 * FileObject DB persistence and audit logging.
 */

import { createHash, randomUUID  } from 'crypto';
import { homedir } from 'os';
import { basename, join } from 'path';
import { Readable } from 'stream';


import {
  localStorageConfigSchema,
  s3StorageConfigSchema,
  sanitizeFileName,
  type IStorageProvider,
  type StorageBucket,
  type StoredObjectMeta,
} from '@luke/core';

import { logAudit } from '../lib/auditLog';
import { getConfig, getConfigOrDefault } from '../lib/configManager';


import { LocalFsProvider } from './providers/local';
import { S3Provider } from './providers/s3';

import type { Context } from '../lib/trpc';
import type { Prisma, PrismaClient } from '@prisma/client';

/** Singleton instance of the active storage provider. */
let providerInstance: IStorageProvider | null = null;
// Promise-based init lock: concurrent callers await the same initialisation
let providerInitPromise: Promise<IStorageProvider> | null = null;

/**
 * Instantiates a LocalFsProvider configured from AppConfig values.
 *
 * @returns Initialized LocalFsProvider ready for use.
 */
export async function loadLocalProvider(prisma: PrismaClient): Promise<LocalFsProvider> {
  // `publicBaseUrl`/`enableProxy` are deliberately not read here: the provider does not use them,
  // URL building reads them from AppConfig itself in `lib/storageUrl.ts`.
  const [rawBasePathConfig, maxFileSizeMB] = await Promise.all([
    getConfig(prisma, 'storage.local.basePath', false),
    getConfigOrDefault(prisma, 'storage.local.maxFileSizeMB'),
  ]);

  // `basePath` keeps its own fallback: `join(homedir(), …)` is not a constant, so it cannot live
  // in `APP_CONFIG_DEFAULTS` with the rest.
  const rawBasePath = rawBasePathConfig || join(homedir(), '.luke', 'storage');
  const basePath = rawBasePath.startsWith('~/')
    ? join(homedir(), rawBasePath.slice(2))
    : rawBasePath;

  const config = localStorageConfigSchema.parse({ basePath, maxFileSizeMB });

  const provider = new LocalFsProvider(config);
  await provider.init();
  return provider;
}

/**
 * Instantiates an S3Provider configured from AppConfig values.
 *
 * @returns Initialized S3Provider ready for use.
 */
export async function loadS3Provider(prisma: PrismaClient): Promise<S3Provider> {
  const [endpoint, port, useSSL, accessKey, secretKey, region, publicBaseUrl, presignedPutTtl, presignedGetTtl] =
    await Promise.all([
      getConfigOrDefault(prisma, 'storage.s3.endpoint'),
      getConfigOrDefault(prisma, 'storage.s3.port'),
      getConfigOrDefault(prisma, 'storage.s3.useSSL'),
      getConfig(prisma, 'storage.s3.accessKey', true),
      getConfig(prisma, 'storage.s3.secretKey', true),
      getConfigOrDefault(prisma, 'storage.s3.region'),
      getConfig(prisma, 'storage.s3.publicBaseUrl', false),
      getConfigOrDefault(prisma, 'storage.s3.presignedPutTtl'),
      getConfigOrDefault(prisma, 'storage.s3.presignedGetTtl'),
    ]);

  // No credential fallback. There used to be one — `accessKey || 's3admin'`, `secretKey ||
  // 's3adminpwd'` — applied unconditionally, production images included. `prisma/seed.ts` writes
  // both rows, so it was dead code everywhere except the one state that most deserves an error:
  // S3 selected and its credentials missing, where it silently connected with a guessable
  // credential instead of saying so. `getSmtpConfig` refuses an incomplete SMTP config for the
  // same reason; there is no argument for the two credential-bearing integrations to differ.
  if (!accessKey || !secretKey) {
    throw new Error(
      "Credenziali S3 non configurate: 'storage.s3.accessKey' e 'storage.s3.secretKey' sono " +
        "obbligatorie quando 'storage.type' è 's3'.",
    );
  }

  const config = s3StorageConfigSchema.parse({
    endpoint,
    port,
    useSSL,
    accessKey,
    secretKey,
    region,
    publicBaseUrl: publicBaseUrl || undefined,
    presignedPutTtl,
    presignedGetTtl,
  });

  const provider = new S3Provider(config);
  await provider.init();
  return provider;
}

/**
 * Returns the singleton storage provider, initializing it on first call.
 *
 * Concurrent callers during initialization await the same promise to avoid
 * creating multiple provider instances.
 *
 * @returns The active IStorageProvider (local FS or S3-compatible).
 */
export async function getStorageProvider(
  prisma: PrismaClient
): Promise<IStorageProvider> {
  if (providerInstance) {
    return providerInstance;
  }

  if (!providerInitPromise) {
    providerInitPromise = (async () => {
      const storageType = await getConfigOrDefault(prisma, 'storage.type');

      let provider: IStorageProvider;
      if (storageType === 's3') {
        provider = await loadS3Provider(prisma);
      } else {
        provider = await loadLocalProvider(prisma);
      }

      providerInstance = provider;
      return provider;
    })().catch(err => {
      // A transient error (malformed JSON, volume not mounted at boot)
      // must not break storage for the rest of the process's lifecycle:
      // without a reset, every subsequent call would reuse this same
      // already-rejected promise even after the cause has been fixed.
      providerInitPromise = null;
      throw err;
    });
  }

  return providerInitPromise;
}

/**
 * Resets the singleton provider, forcing re-initialization on the next call.
 * Intended for testing and config-reload scenarios.
 */
export function resetStorageProvider(): void {
  providerInstance = null;
  providerInitPromise = null;
}

/**
 * Uploads a file to the active storage provider and persists its metadata to the DB.
 *
 * Sanitizes the filename before upload and computes a SHA-256 checksum.
 * Creates a FileObject record (unconfirmed when `pending: true`) and writes an audit log entry.
 *
 * @returns Metadata of the stored object, including its generated key and checksum.
 */
/** Minimal shape both `putObject`/`putDerivativeObject`'s Prisma `create()` results and `listObjects`'s `findMany()` rows satisfy — enough to build a `StoredObjectMeta`. */
type FileObjectRow = {
  id: string;
  bucket: string;
  key: string;
  originalName: string;
  size: number;
  contentType: string;
  checksumSha256: string;
  createdBy: string;
  createdAt: Date;
  parentId: string | null;
  variant: string | null;
  width: number | null;
  height: number | null;
};

/** Shared by every function that turns a `FileObject` row into the public `StoredObjectMeta` shape — one place to keep in sync when either type gains a field. */
function toStoredObjectMeta(row: FileObjectRow): StoredObjectMeta {
  return {
    id: row.id,
    bucket: row.bucket as StorageBucket,
    key: row.key,
    originalName: row.originalName,
    size: row.size,
    contentType: row.contentType,
    checksumSha256: row.checksumSha256,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    parentId: row.parentId,
    variant: row.variant,
    width: row.width,
    height: row.height,
  };
}

export async function putObject(
  ctx: Context,
  params: {
    bucket: StorageBucket;
    originalName: string;
    contentType?: string;
    size: number;
    stream: NodeJS.ReadableStream;
    /** If true, confirmedAt = null (file is pending confirmation before linking to an entity) */
    pending?: boolean;
    /** Explicit key to use instead of provider-generated (e.g. a derivative's deterministic key from `buildVariantKey`). */
    key?: string;
    /** Asset pipeline fields — set only when this row is part of the master/derivative tree (see `asset.service.ts`). */
    parentId?: string;
    variant?: string;
    pipelineVersion?: number;
    width?: number;
    height?: number;
  }
): Promise<StoredObjectMeta> {
  const provider = await getStorageProvider(ctx.prisma);

  // Sanitize file name
  const sanitizedName = sanitizeFileName(params.originalName);

  // Upload via the provider
  const { key, checksumSha256, size } = await provider.put({
    bucket: params.bucket,
    originalName: sanitizedName,
    contentType: params.contentType || 'application/octet-stream',
    size: params.size,
    stream: params.stream,
    key: params.key,
  });

  // Save metadata to DB
  const fileObject = await ctx.prisma.fileObject.create({
    data: {
      id: randomUUID(),
      bucket: params.bucket,
      key,
      originalName: sanitizedName,
      size,
      contentType: params.contentType || 'application/octet-stream',
      checksumSha256,
      createdBy: ctx.session?.user.id || 'system',
      confirmedAt: params.pending ? null : new Date(),
      parentId: params.parentId,
      variant: params.variant,
      pipelineVersion: params.pipelineVersion,
      width: params.width,
      height: params.height,
    },
  });

  // Log audit
  await logAudit(ctx, {
    action: 'FILE_UPLOADED',
    targetType: 'FileObject',
    targetId: fileObject.id,
    result: 'SUCCESS',
    metadata: {
      bucket: params.bucket,
      key,
      size,
      originalName: sanitizedName,
    },
  });

  return toStoredObjectMeta(fileObject);
}

/**
 * Writes one derivative (thumb/card/export) of a master `FileObject` — used by the
 * asset pipeline (`asset.service.ts`, both the sync-in-request variant and the
 * background derivative worker). Takes `prisma` directly rather than a full
 * `Context`: the background worker has no HTTP request to build one from. No
 * per-call audit entry — the master's own upload audit entry already covers this
 * upload; a derivative isn't an independent user action.
 *
 * `masterConfirmedAt` is mirrored onto the derivative rather than always confirming
 * it immediately: if the master is still a *pending* upload (not yet linked to an
 * entity), its derivative must stay pending too, so `confirmPendingFile` confirms
 * both together — otherwise a pending upload that's later abandoned would leave a
 * confirmed derivative behind for the reaper to never touch (it only reaps
 * masters, see `setupTempFileCleanup` in `server.ts`).
 */
export async function putDerivativeObject(
  prisma: PrismaClient,
  params: {
    bucket: StorageBucket;
    /** Deterministic key from `buildVariantKey` — never provider-generated. */
    key: string;
    parentId: string;
    variant: string;
    pipelineVersion: number;
    contentType: string;
    buffer: Buffer;
    width: number | null;
    height: number | null;
    createdBy: string;
    masterConfirmedAt: Date | null;
  }
): Promise<StoredObjectMeta> {
  const provider = await getStorageProvider(prisma);

  const { key, checksumSha256, size } = await provider.put({
    bucket: params.bucket,
    originalName: params.variant,
    contentType: params.contentType,
    size: params.buffer.byteLength,
    stream: Readable.from(params.buffer),
    key: params.key,
  });

  const fileObject = await prisma.fileObject.create({
    data: {
      id: randomUUID(),
      bucket: params.bucket,
      key,
      originalName: params.variant,
      size,
      contentType: params.contentType,
      checksumSha256,
      createdBy: params.createdBy,
      confirmedAt: params.masterConfirmedAt,
      parentId: params.parentId,
      variant: params.variant,
      pipelineVersion: params.pipelineVersion,
      width: params.width,
      height: params.height,
    },
  });

  return toStoredObjectMeta(fileObject);
}

/**
 * Retrieves file metadata from the DB by FileObject ID.
 *
 * @returns The stored object metadata, or `null` if not found.
 */
export async function getObjectMetadata(
  prisma: PrismaClient,
  id: string
): Promise<StoredObjectMeta | null> {
  const fileObject = await prisma.fileObject.findUnique({
    where: { id },
  });

  if (!fileObject) {
    return null;
  }

  return toStoredObjectMeta(fileObject);
}

/**
 * Downloads a file from storage by its FileObject ID.
 *
 * Fetches metadata from DB, retrieves the stream from the provider, and writes an audit log entry.
 *
 * @returns An object containing the readable stream and the file metadata.
 */
export async function getObject(
  ctx: Context,
  id: string
): Promise<{
  stream: NodeJS.ReadableStream;
  metadata: StoredObjectMeta;
}> {
  const provider = await getStorageProvider(ctx.prisma);

  // Retrieve metadata
  const metadata = await getObjectMetadata(ctx.prisma, id);
  if (!metadata) {
    throw new Error('File non trovato');
  }

  // Download via the provider
  const { stream } = await provider.get({
    bucket: metadata.bucket,
    key: metadata.key,
  });

  // Log audit
  await logAudit(ctx, {
    action: 'FILE_DOWNLOADED',
    targetType: 'FileObject',
    targetId: id,
    result: 'SUCCESS',
    metadata: {
      bucket: metadata.bucket,
      key: metadata.key,
    },
  });

  return {
    stream,
    metadata,
  };
}

/**
 * Deletes a file from storage and removes its metadata from the DB.
 *
 * Writes an audit log entry on success.
 */
export async function deleteObject(ctx: Context, id: string): Promise<void> {
  const provider = await getStorageProvider(ctx.prisma);

  // Retrieve metadata
  const metadata = await getObjectMetadata(ctx.prisma, id);
  if (!metadata) {
    throw new Error('File non trovato');
  }

  // The FK's onDelete:Cascade removes derivative *rows* once the master row is
  // deleted below, but Postgres cascade never touches the storage provider — a
  // derivative's physical object must be removed here explicitly, or it becomes
  // a permanent orphan on disk/S3 (same fix already applied to the temp-file
  // reaper in server.ts, extended here to every confirmed-delete call site).
  const derivatives = await ctx.prisma.fileObject.findMany({
    where: { parentId: id },
    select: { bucket: true, key: true },
  });
  for (const derivative of derivatives) {
    try {
      await provider.delete({ bucket: derivative.bucket as StorageBucket, key: derivative.key });
    } catch (err) {
      ctx.logger?.warn(
        { err, bucket: derivative.bucket, key: derivative.key },
        'Failed to delete derivative file from storage'
      );
    }
  }

  // Delete from provider
  await provider.delete({
    bucket: metadata.bucket,
    key: metadata.key,
  });

  // Delete metadata from DB
  await ctx.prisma.fileObject.delete({
    where: { id },
  });

  // Log audit
  await logAudit(ctx, {
    action: 'FILE_DELETED',
    targetType: 'FileObject',
    targetId: id,
    result: 'SUCCESS',
    metadata: {
      bucket: metadata.bucket,
      key: metadata.key,
      originalName: metadata.originalName,
    },
  });
}

/**
 * Deletes a file from storage and the DB by bucket and key, without requiring its FileObject ID.
 *
 * Used to clean up old file versions (e.g. brand logo, row picture) when only the key
 * extracted from a saved URL is available. Physical deletion is best-effort: if the file
 * is already gone from the provider, the error is logged as a warning and DB cleanup proceeds.
 * Writes an audit log entry only if a matching FileObject record exists in the DB.
 */
export async function deleteObjectByKey(
  ctx: Context,
  params: { bucket: StorageBucket; key: string }
): Promise<void> {
  const provider = await getStorageProvider(ctx.prisma);

  // Looked up before the physical delete (not after, as before) so its derivatives
  // can be found and cleaned up while the master row still exists — the FK's
  // onDelete:Cascade would otherwise remove derivative *rows* the moment the
  // master row disappears below, without ever touching their physical objects.
  const fileObject = await ctx.prisma.fileObject.findFirst({
    where: { bucket: params.bucket, key: params.key },
  });

  if (fileObject) {
    const derivatives = await ctx.prisma.fileObject.findMany({
      where: { parentId: fileObject.id },
      select: { bucket: true, key: true },
    });
    for (const derivative of derivatives) {
      try {
        await provider.delete({ bucket: derivative.bucket as StorageBucket, key: derivative.key });
      } catch (err) {
        ctx.logger?.warn(
          { err, bucket: derivative.bucket, key: derivative.key },
          'Failed to delete derivative file from storage'
        );
      }
    }
  }

  // Delete from provider (best-effort: don't block if the physical file doesn't exist)
  try {
    await provider.delete({ bucket: params.bucket, key: params.key });
  } catch (err) {
    ctx.logger?.warn(
      { err, bucket: params.bucket, key: params.key },
      'Physical file delete failed (may already be gone)'
    );
  }

  if (fileObject) {
    await ctx.prisma.fileObject.delete({ where: { id: fileObject.id } });

    await logAudit(ctx, {
      action: 'FILE_DELETED',
      targetType: 'FileObject',
      targetId: fileObject.id,
      result: 'SUCCESS',
      metadata: {
        bucket: params.bucket,
        key: params.key,
        originalName: fileObject.originalName,
      },
    });
  }
}

/**
 * Reads a file from storage as a Buffer, identified by bucket and key.
 *
 * Used internally for PDF/XLSX exports where no session context is available.
 * Returns `null` and logs a warning if the file cannot be read.
 */
export async function readFileBuffer(
  prisma: PrismaClient,
  bucket: StorageBucket,
  key: string,
  logger?: { warn: (obj: object, msg: string) => void },
): Promise<Buffer | null> {
  try {
    const provider = await getStorageProvider(prisma);
    const { stream } = await provider.get({ bucket, key });
    const chunks: Buffer[] = [];
    return await new Promise<Buffer>((resolve, reject) => {
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', reject);
    });
  } catch (err) {
    logger?.warn({ err, bucket, key }, 'readFileBuffer: failed to read file');
    return null;
  }
}

/**
 * Returns a cursor-paginated list of stored file metadata from the DB.
 *
 * Results are ordered by creation time (newest first).
 *
 * @returns Page of file metadata and an optional cursor for the next page.
 */
export async function listObjects(
  prisma: PrismaClient,
  params: {
    bucket?: StorageBucket;
    limit?: number;
    cursor?: string;
  }
): Promise<{
  items: StoredObjectMeta[];
  nextCursor?: string;
}> {
  const limit = params.limit || 50;

  // Cursor-based paginated query
  const where: Prisma.FileObjectWhereInput = {};
  if (params.bucket) {
    where.bucket = params.bucket;
  }
  // Use Prisma's built-in cursor (consistent with orderBy: createdAt desc)
  // Avoids id > cursor / createdAt desc mismatch that caused skipped/duplicated pages
  const items = await prisma.fileObject.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit + 1,
    ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
  });

  const hasMore = items.length > limit;
  const results = hasMore ? items.slice(0, limit) : items;

  return {
    items: results.map(toStoredObjectMeta),
    nextCursor: hasMore ? results[results.length - 1]?.id : undefined,
  };
}

/**
 * Copies a photo from `collection-row-pictures` into the immutable
 * `collection-row-pictures-revisions` bucket for the ISO 9001 quality register.
 *
 * Deduplicates via SHA-256: if an identical file already exists in the immutable
 * bucket, returns the existing key without re-uploading (CAS semantics via DB lookup).
 *
 * If the enclosing revision transaction rolls back after this call, the copied file
 * becomes an orphan in storage. This is acceptable because the content is identical
 * (same SHA-256) and produces no logical duplicates.
 *
 * @returns The storage key of the immutable copy.
 */
export async function copyToImmutableBucket(
  prisma: PrismaClient,
  sourceKey: string,
  logger?: { warn: (obj: object, msg: string) => void },
): Promise<string> {
  // Read source file — the master (or its already-normalized bytes if it went
  // through the asset pipeline), never a derivative: this is the ISO 9001 quality
  // register, which preserves full quality, not a downsized preview.
  const [buffer, sourceFileObject] = await Promise.all([
    readFileBuffer(prisma, 'collection-row-pictures', sourceKey, logger),
    prisma.fileObject.findFirst({
      where: { bucket: 'collection-row-pictures', key: sourceKey },
      select: { contentType: true },
    }),
  ]);
  if (!buffer) {
    throw new Error(`copyToImmutableBucket: source file not found — key=${sourceKey}`);
  }
  // Real content-type from the source's own FileObject row — never assumed. A
  // hardcoded 'image/jpeg' here previously mislabeled every PNG/WebP row picture
  // copied into the immutable register.
  const contentType = sourceFileObject?.contentType ?? 'application/octet-stream';

  // Compute sha256 for dedup
  const sha256 = createHash('sha256').update(buffer).digest('hex');

  // Dedup: check if already in immutable bucket
  const existing = await prisma.fileObject.findFirst({
    where: { bucket: 'collection-row-pictures-revisions', checksumSha256: sha256 },
    select: { key: true },
  });
  if (existing) {
    return existing.key;
  }

  // Not found — upload to immutable bucket
  const originalName = sanitizeFileName(basename(sourceKey)) || 'picture.jpg';
  const provider = await getStorageProvider(prisma);
  const stream = Readable.from(buffer);
  const { key } = await provider.put({
    bucket: 'collection-row-pictures-revisions',
    originalName,
    contentType,
    size: buffer.byteLength,
    stream,
  });

  // Persist FileObject record
  await prisma.fileObject.create({
    data: {
      id: randomUUID(),
      bucket: 'collection-row-pictures-revisions',
      key,
      originalName,
      size: buffer.byteLength,
      contentType,
      checksumSha256: sha256,
      createdBy: 'system',
      confirmedAt: new Date(),
    },
  });

  return key;
}
