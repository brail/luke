/**
 * Storage Service Layer
 *
 * Factory per provider storage e funzioni high-level per gestione file
 * Integra provider, persistenza DB e AuditLog
 */

import { randomUUID } from 'crypto';

import type { PrismaClient } from '@prisma/client';

import {
  localStorageConfigSchema,
  sanitizeFileName,
  type IStorageProvider,
  type StorageBucket,
  type StoredObjectMeta,
} from '@luke/core';

import { logAudit } from '../lib/auditLog';
import { getConfig } from '../lib/configManager';

import type { Context } from '../lib/trpc';

import { LocalFsProvider } from './providers/local';

/**
 * Istanza singleton del provider storage
 */
let providerInstance: IStorageProvider | null = null;

/**
 * Carica configurazione storage da AppConfig
 */
async function loadStorageConfig(prisma: PrismaClient) {
  const storageType =
    (await getConfig(prisma, 'storage.type', false)) || 'local';

  if (storageType !== 'local') {
    throw new Error(
      `Tipo storage non supportato: ${storageType}. Solo 'local' è implementato.`
    );
  }

  // Carica config locale
  const basePath =
    (await getConfig(prisma, 'storage.local.basePath', false)) ||
    '/tmp/luke-storage';

  const maxFileSizeMBStr =
    (await getConfig(prisma, 'storage.local.maxFileSizeMB', false)) || '50';
  const maxFileSizeMB = parseInt(maxFileSizeMBStr, 10);

  const bucketsStr =
    (await getConfig(prisma, 'storage.local.buckets', false)) ||
    '["uploads","exports","assets","brand-logos","temp-brand-logos"]';
  const buckets = JSON.parse(bucketsStr);

  // Valida con schema Zod
  const config = localStorageConfigSchema.parse({
    basePath,
    maxFileSizeMB,
    buckets,
  });

  return config;
}

/**
 * Crea o ritorna istanza singleton del provider storage
 */
export async function getStorageProvider(
  prisma: PrismaClient
): Promise<IStorageProvider> {
  if (!providerInstance) {
    const config = await loadStorageConfig(prisma);
    const provider = new LocalFsProvider(config);

    // Inizializza provider (crea directory)
    await provider.init();

    providerInstance = provider;
  }

  return providerInstance;
}

/**
 * Reset provider instance (per testing o reload config)
 */
export function resetStorageProvider(): void {
  providerInstance = null;
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
  if (params.cursor) {
    where.id = {
      gt: params.cursor,
    };
  }

  const items = await prisma.fileObject.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit + 1, // +1 per determinare hasMore
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
