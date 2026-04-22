/**
 * Storage Service Layer
 *
 * Factory per provider storage e funzioni high-level per gestione file
 * Integra provider, persistenza DB e AuditLog
 */

import { randomUUID } from 'crypto';
import { homedir } from 'os';
import { join } from 'path';

import type { PrismaClient } from '@prisma/client';

import {
  localStorageConfigSchema,
  minioStorageConfigSchema,
  sanitizeFileName,
  type IStorageProvider,
  type StorageBucket,
  type StoredObjectMeta,
} from '@luke/core';

import { logAudit } from '../lib/auditLog';
import { getConfig } from '../lib/configManager';

import type { Context } from '../lib/trpc';

import { LocalFsProvider } from './providers/local';
import { MinioProvider } from './providers/minio';

/**
 * Istanza singleton del provider storage
 */
let providerInstance: IStorageProvider | null = null;
// Promise-based init lock: concurrent callers await the same initialisation
let providerInitPromise: Promise<IStorageProvider> | null = null;

async function loadLocalProvider(prisma: PrismaClient): Promise<LocalFsProvider> {
  const rawBasePath =
    (await getConfig(prisma, 'storage.local.basePath', false)) ||
    join(homedir(), '.luke', 'storage');
  const basePath = rawBasePath.startsWith('~/')
    ? join(homedir(), rawBasePath.slice(2))
    : rawBasePath;

  const maxFileSizeMBStr =
    (await getConfig(prisma, 'storage.local.maxFileSizeMB', false)) || '50';
  const maxFileSizeMB = parseInt(maxFileSizeMBStr, 10);

  const bucketsStr =
    (await getConfig(prisma, 'storage.local.buckets', false)) ||
    '["uploads","exports","assets","brand-logos","collection-row-pictures","merchandising-specsheet-images"]';
  const buckets = JSON.parse(bucketsStr);

  const publicBaseUrl = await getConfig(prisma, 'storage.local.publicBaseUrl', false);
  const enableProxyStr = await getConfig(prisma, 'storage.local.enableProxy', false);
  const enableProxy = enableProxyStr ? enableProxyStr === 'true' : true;

  const config = localStorageConfigSchema.parse({
    basePath,
    maxFileSizeMB,
    buckets,
    publicBaseUrl: publicBaseUrl || undefined,
    enableProxy,
  });

  const provider = new LocalFsProvider(config);
  await provider.init();
  return provider;
}

export async function loadMinioProvider(prisma: PrismaClient): Promise<MinioProvider> {
  const [endpoint, portStr, useSslStr, accessKey, secretKey, region, publicBaseUrl, putTtlStr, getTtlStr] =
    await Promise.all([
      getConfig(prisma, 'storage.minio.endpoint', false),
      getConfig(prisma, 'storage.minio.port', false),
      getConfig(prisma, 'storage.minio.useSSL', false),
      getConfig(prisma, 'storage.minio.accessKey', true),
      getConfig(prisma, 'storage.minio.secretKey', true),
      getConfig(prisma, 'storage.minio.region', false),
      getConfig(prisma, 'storage.minio.publicBaseUrl', false),
      getConfig(prisma, 'storage.minio.presignedPutTtl', false),
      getConfig(prisma, 'storage.minio.presignedGetTtl', false),
    ]);

  const config = minioStorageConfigSchema.parse({
    endpoint: endpoint || 'localhost',
    port: parseInt(portStr || '9000', 10),
    useSSL: useSslStr === 'true',
    accessKey: accessKey || 'minioadmin',
    secretKey: secretKey || 'minioadmin',
    region: region || 'us-east-1',
    publicBaseUrl: publicBaseUrl || undefined,
    presignedPutTtl: parseInt(putTtlStr || '3600', 10),
    presignedGetTtl: parseInt(getTtlStr || '3600', 10),
  });

  return new MinioProvider(config);
}

/**
 * Crea o ritorna istanza singleton del provider storage
 */
export async function getStorageProvider(
  prisma: PrismaClient
): Promise<IStorageProvider> {
  if (providerInstance) {
    return providerInstance;
  }

  if (!providerInitPromise) {
    providerInitPromise = (async () => {
      const storageType = (await getConfig(prisma, 'storage.type', false)) || 'local';

      let provider: IStorageProvider;
      if (storageType === 'minio') {
        provider = await loadMinioProvider(prisma);
      } else {
        provider = await loadLocalProvider(prisma);
      }

      providerInstance = provider;
      return provider;
    })();
  }

  return providerInitPromise;
}

/**
 * Reset provider instance (per testing o reload config)
 */
export function resetStorageProvider(): void {
  providerInstance = null;
  providerInitPromise = null;
}

/**
 * Upload file e salva metadati in DB
 */
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
  }
): Promise<StoredObjectMeta> {
  const provider = await getStorageProvider(ctx.prisma);

  // Sanitizza nome file
  const sanitizedName = sanitizeFileName(params.originalName);

  // Upload tramite provider
  const { key, checksumSha256, size } = await provider.put({
    bucket: params.bucket,
    originalName: sanitizedName,
    contentType: params.contentType || 'application/octet-stream',
    size: params.size,
    stream: params.stream,
  });

  // Salva metadati in DB
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

  return {
    id: fileObject.id,
    bucket: fileObject.bucket as StorageBucket,
    key: fileObject.key,
    originalName: fileObject.originalName,
    size: fileObject.size,
    contentType: fileObject.contentType,
    checksumSha256: fileObject.checksumSha256,
    createdBy: fileObject.createdBy,
    createdAt: fileObject.createdAt,
  };
}

/**
 * Recupera metadati file dal DB
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

  return {
    id: fileObject.id,
    bucket: fileObject.bucket as StorageBucket,
    key: fileObject.key,
    originalName: fileObject.originalName,
    size: fileObject.size,
    contentType: fileObject.contentType,
    checksumSha256: fileObject.checksumSha256,
    createdBy: fileObject.createdBy,
    createdAt: fileObject.createdAt,
  };
}

/**
 * Download file dallo storage
 */
export async function getObject(
  ctx: Context,
  id: string
): Promise<{
  stream: NodeJS.ReadableStream;
  metadata: StoredObjectMeta;
}> {
  const provider = await getStorageProvider(ctx.prisma);

  // Recupera metadati
  const metadata = await getObjectMetadata(ctx.prisma, id);
  if (!metadata) {
    throw new Error('File non trovato');
  }

  // Download tramite provider
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
 * Cancella file dallo storage e DB
 */
export async function deleteObject(ctx: Context, id: string): Promise<void> {
  const provider = await getStorageProvider(ctx.prisma);

  // Recupera metadati
  const metadata = await getObjectMetadata(ctx.prisma, id);
  if (!metadata) {
    throw new Error('File non trovato');
  }

  // Cancella da provider
  await provider.delete({
    bucket: metadata.bucket,
    key: metadata.key,
  });

  // Cancella metadati da DB
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
 * Cancella file dallo storage e DB tramite bucket+key (senza conoscerne l'ID).
 * Usato per cleanup delle vecchie versioni di file (brand logo, row picture, ecc.)
 * dove si conosce solo la key estratta dall'URL salvato in DB.
 */
export async function deleteObjectByKey(
  ctx: Context,
  params: { bucket: StorageBucket; key: string }
): Promise<void> {
  const provider = await getStorageProvider(ctx.prisma);

  // Cancella da provider (best-effort: non bloccare se il file fisico non esiste)
  try {
    await provider.delete({ bucket: params.bucket, key: params.key });
  } catch (err) {
    ctx.logger?.warn(
      { err, bucket: params.bucket, key: params.key },
      'Physical file delete failed (may already be gone)'
    );
  }

  // Cancella metadati da DB se esistono
  const fileObject = await ctx.prisma.fileObject.findFirst({
    where: { bucket: params.bucket, key: params.key },
  });

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
 * Legge un file dallo storage come Buffer, identificato da bucket+key.
 * Usato internamente per export (PDF/XLSX) senza richiedere una session.
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
 * Lista file paginata dal DB
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

  // Query con paginazione cursor-based
  const where: any = {};
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
    items: results.map(item => ({
      id: item.id,
      bucket: item.bucket as StorageBucket,
      key: item.key,
      originalName: item.originalName,
      size: item.size,
      contentType: item.contentType,
      checksumSha256: item.checksumSha256,
      createdBy: item.createdBy,
      createdAt: item.createdAt,
    })),
    nextCursor: hasMore ? results[results.length - 1]?.id : undefined,
  };
}
