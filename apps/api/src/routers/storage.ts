/**
 * Router tRPC per Storage
 *
 * Procedure per gestione file storage con RBAC e AuditLog
 */

import { randomUUID } from 'crypto';

import { TRPCError } from '@trpc/server';
import { homedir } from 'os';
import { join } from 'path';
import { z } from 'zod';

import { isValidBucket, localStorageConfigSchema, type StorageBucket } from '@luke/core';

import { requirePermission } from '../lib/permissions';
import { router, protectedProcedure } from '../lib/trpc';
import { withSectionAccess } from '../lib/sectionAccessMiddleware';
import { getConfig, saveConfig } from '../lib/configManager';
import { getStorageUrlConfig, resolvePublicUrl } from '../lib/storageUrl';
import { getObjectMetadata, listObjects, deleteObject, resetStorageProvider, getStorageProvider, loadMinioProvider } from '../storage';
import { signDownloadToken } from '../utils/downloadToken';

/**
 * Schema per list files
 */
const ListFilesSchema = z.object({
  bucket: z.string().optional(),
  limit: z.number().int().positive().max(100).optional(),
  cursor: z.string().optional(),
});

/**
 * Schema per delete file
 */
const DeleteFileSchema = z.object({
  id: z.string().uuid(),
});

/**
 * Schema per get download link
 */
const GetDownloadLinkSchema = z.object({
  id: z.string().uuid(),
});

const IMAGE_BUCKETS = ['uploads', 'exports', 'assets', 'brand-logos', 'collection-row-pictures', 'merchandising-specsheet-images'] as const;

/**
 * Schema per create upload
 */
const CreateUploadSchema = z.object({
  bucket: z.enum(IMAGE_BUCKETS),
  originalName: z.string().min(1).max(255),
  contentType: z.string().optional(),
  size: z.number().int().positive(),
});

const RequestUploadSchema = z.object({
  bucket: z.enum(IMAGE_BUCKETS),
  contentType: z.string().min(1),
  size: z.number().int().positive(),
  originalName: z.string().min(1).max(255),
  /** Pre-allocated key (for presigned path, so client knows the URL before upload) */
  key: z.string().optional(),
});

const ConfirmUploadSchema = z.object({
  bucket: z.enum(IMAGE_BUCKETS),
  key: z.string().min(1),
  contentType: z.string().min(1),
  size: z.number().int().positive(),
  originalName: z.string().min(1).max(255),
  checksumSha256: z.string().optional(),
});

const SaveStorageConfigSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('local'),
    basePath: z.string().min(1),
    maxFileSizeMB: z.number().int().positive().min(1).max(1000),
    buckets: z.array(z.enum(IMAGE_BUCKETS)),
    enableProxy: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('minio'),
    endpoint: z.string().min(1),
    port: z.number().int().min(1).max(65535),
    useSSL: z.boolean(),
    accessKey: z.string().min(1),
    secretKey: z.string().min(1),
    region: z.string().min(1),
    publicBaseUrl: z.string().url().optional().or(z.literal('')),
    presignedPutTtl: z.number().int().min(60).max(86400),
    presignedGetTtl: z.number().int().min(60).max(86400),
  }),
]);

/**
 * Router Storage
 */
export const storageRouter = router({
  /**
   * Lista file con paginazione
   * Accessibile a tutti gli utenti autenticati
   */
  list: protectedProcedure
    .use(requirePermission('config:read'))
    .input(ListFilesSchema)
    .query(async ({ input, ctx }) => {
      // Valida bucket se specificato
      if (input.bucket && !isValidBucket(input.bucket)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Bucket non valido',
        });
      }

      const result = await listObjects(ctx.prisma, {
        bucket: input.bucket as any, // Safe: validated by isValidBucket() guard above
        limit: input.limit,
        cursor: input.cursor,
      });

      return {
        items: result.items.map(item => ({
          id: item.id,
          bucket: item.bucket,
          key: item.key,
          originalName: item.originalName,
          size: item.size,
          contentType: item.contentType,
          checksumSha256: item.checksumSha256,
          createdBy: item.createdBy,
          createdAt: item.createdAt.toISOString(),
        })),
        nextCursor: result.nextCursor,
      };
    }),

  /**
   * Ottieni metadati di un file
   * Accessibile a tutti gli utenti autenticati
   */
  getMetadata: protectedProcedure
    .input(GetDownloadLinkSchema)
    .query(async ({ input, ctx }) => {
      const metadata = await getObjectMetadata(ctx.prisma, input.id);

      if (!metadata) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'File non trovato',
        });
      }

      // Verifica ownership o admin/editor
      const isOwner = metadata.createdBy === ctx.session.user.id;
      const isAdminOrEditor = ['admin', 'editor'].includes(
        ctx.session.user.role
      );

      if (!isOwner && !isAdminOrEditor) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Non hai i permessi per accedere a questo file',
        });
      }

      return {
        id: metadata.id,
        bucket: metadata.bucket,
        key: metadata.key,
        originalName: metadata.originalName,
        size: metadata.size,
        contentType: metadata.contentType,
        checksumSha256: metadata.checksumSha256,
        createdBy: metadata.createdBy,
        createdAt: metadata.createdAt.toISOString(),
      };
    }),

  /**
   * Genera link download firmato
   * Accessibile a tutti gli utenti autenticati (con ownership check)
   */
  getDownloadLink: protectedProcedure
    .input(GetDownloadLinkSchema)
    .mutation(async ({ input, ctx }) => {
      const metadata = await getObjectMetadata(ctx.prisma, input.id);

      if (!metadata) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'File non trovato',
        });
      }

      // Verifica ownership o admin/editor
      const isOwner = metadata.createdBy === ctx.session.user.id;
      const isAdminOrEditor = ['admin', 'editor'].includes(
        ctx.session.user.role
      );

      if (!isOwner && !isAdminOrEditor) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Non hai i permessi per scaricare questo file',
        });
      }

      // Genera token firmato (TTL 5 minuti)
      const token = signDownloadToken({
        bucket: metadata.bucket,
        key: metadata.key,
      });

      // Costruisci URL usando la stessa base configurata per lo storage proxy
      const { publicBaseUrl } = await getStorageUrlConfig(ctx.prisma);
      const baseUrl = publicBaseUrl || `http://localhost:${process.env.PORT || 3001}`;
      const downloadUrl = `${baseUrl}/storage/download?token=${token}`;

      return {
        url: downloadUrl,
        expiresIn: 300, // 5 minuti in secondi
      };
    }),

  /**
   * Request an upload slot.
   * - MinIO: returns presigned PUT URL + key for direct client upload
   * - Local: returns proxy info (use entity-specific Fastify endpoint as fallback)
   */
  requestUpload: protectedProcedure
    .input(RequestUploadSchema)
    .mutation(async ({ input, ctx }) => {
      const provider = await getStorageProvider(ctx.prisma);

      if (provider.capabilities.supportsPresignedUpload && provider.getPresignedPutUrl) {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const ext = input.contentType === 'image/png' ? '.png'
                  : input.contentType === 'image/webp' ? '.webp'
                  : '.jpg';
        const key = input.key ?? `${year}/${month}/${day}/${randomUUID()}${ext}`;

        const { url, expiresAt } = await provider.getPresignedPutUrl({
          bucket: input.bucket as StorageBucket,
          key,
          contentType: input.contentType,
          size: input.size,
        });

        return {
          method: 'presigned' as const,
          presignedUrl: url,
          key,
          expiresAt: expiresAt.toISOString(),
        };
      }

      // Local storage: caller should use entity-specific upload endpoint
      return {
        method: 'proxy' as const,
        presignedUrl: null,
        key: null,
        expiresAt: null,
      };
    }),

  /**
   * Confirm a completed presigned upload — creates the FileObject DB record.
   * Only needed for the presigned (MinIO) path; local proxy endpoints handle this internally.
   */
  confirmUpload: protectedProcedure
    .input(ConfirmUploadSchema)
    .mutation(async ({ input, ctx }) => {
      const publicUrl = await resolvePublicUrl(ctx.prisma, input.bucket as StorageBucket, input.key);

      const fileObject = await ctx.prisma.fileObject.create({
        data: {
          id: randomUUID(),
          bucket: input.bucket,
          key: input.key,
          originalName: input.originalName,
          size: input.size,
          contentType: input.contentType,
          checksumSha256: input.checksumSha256 ?? '',
          createdBy: ctx.session.user.id,
          confirmedAt: new Date(),
        },
      });

      return {
        fileId: fileObject.id,
        publicUrl,
        key: input.key,
      };
    }),

  /**
   * Prepara upload (genera uploadId e URL) — legacy endpoint
   * Accessibile a tutti gli utenti autenticati
   */
  createUpload: protectedProcedure
    .input(CreateUploadSchema)
    .mutation(async ({ input, ctx }) => {
      const maxSizeMBStr = await getConfig(ctx.prisma, 'storage.local.maxFileSizeMB', false);
      const maxSizeMB = parseInt(maxSizeMBStr || '50', 10);
      const maxSizeBytes = maxSizeMB * 1024 * 1024;

      if (input.size > maxSizeBytes) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `File troppo grande. Massimo ${maxSizeMB}MB`,
        });
      }

      const uploadId = randomUUID();
      const { publicBaseUrl } = await getStorageUrlConfig(ctx.prisma);
      const baseUrl = publicBaseUrl || `http://localhost:${process.env.PORT || 3001}`;
      const uploadUrl = `${baseUrl}/storage/upload/${uploadId}`;

      return {
        uploadId,
        uploadUrl,
        bucket: input.bucket,
        maxSizeBytes,
      };
    }),

  /**
   * Cancella file
   * Solo admin e editor possono cancellare file
   */
  delete: protectedProcedure
    .use(requirePermission('config:update'))
    .input(DeleteFileSchema)
    .mutation(async ({ input, ctx }) => {
      // Verifica esistenza
      const metadata = await getObjectMetadata(ctx.prisma, input.id);
      if (!metadata) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'File non trovato',
        });
      }

      // Cancella file e metadati
      await deleteObject(ctx, input.id);

      return {
        success: true,
        message: 'File cancellato con successo',
      };
    }),

  testMinioConnection: protectedProcedure
    .use(requirePermission('config:read'))
    .mutation(async ({ ctx }) => {
      const storageType = await getConfig(ctx.prisma, 'storage.type', false);
      if (storageType !== 'minio') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Provider attuale non è MinIO. Salva prima la configurazione MinIO.',
        });
      }

      let provider;
      try {
        provider = await loadMinioProvider(ctx.prisma);
      } catch (err: unknown) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Errore caricamento config MinIO: ${err instanceof Error ? err.message : String(err)}`,
        });
      }

      // Verifica connettività listando un bucket
      try {
        await provider.list({ bucket: 'uploads', limit: 1 });
      } catch (err: unknown) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Connessione a MinIO fallita: ${err instanceof Error ? err.message : String(err)}`,
        });
      }

      // Genera URL presigned di prova per mostrare il base URL che riceverà il browser
      const presignResult = await provider.getPresignedPutUrl!({
        bucket: 'uploads',
        key: '_test/probe.jpg',
        contentType: 'image/jpeg',
        size: 1,
      });
      const presignedUrlBase = new URL(presignResult.url).origin;

      return {
        success: true,
        message: 'Connessione MinIO riuscita',
        presignedUrlBase,
      };
    }),

  getConfig: protectedProcedure
    .use(requirePermission('config:read'))
    .use(withSectionAccess('settings'))
    .query(async ({ ctx }) => {
      const [
        storageType,
        basePath, maxFileSizeMBStr, bucketsStr, enableProxyStr,
        minioEndpoint, minioPortStr, minioUseSslStr, minioAccessKey, minioSecretKey,
        minioRegion, minioPublicBaseUrl, minioPutTtlStr, minioGetTtlStr,
      ] = await Promise.all([
        getConfig(ctx.prisma, 'storage.type', false),
        getConfig(ctx.prisma, 'storage.local.basePath', false),
        getConfig(ctx.prisma, 'storage.local.maxFileSizeMB', false),
        getConfig(ctx.prisma, 'storage.local.buckets', false),
        getConfig(ctx.prisma, 'storage.local.enableProxy', false),
        getConfig(ctx.prisma, 'storage.minio.endpoint', false),
        getConfig(ctx.prisma, 'storage.minio.port', false),
        getConfig(ctx.prisma, 'storage.minio.useSSL', false),
        getConfig(ctx.prisma, 'storage.minio.accessKey', true),
        getConfig(ctx.prisma, 'storage.minio.secretKey', true),
        getConfig(ctx.prisma, 'storage.minio.region', false),
        getConfig(ctx.prisma, 'storage.minio.publicBaseUrl', false),
        getConfig(ctx.prisma, 'storage.minio.presignedPutTtl', false),
        getConfig(ctx.prisma, 'storage.minio.presignedGetTtl', false),
      ]);

      let buckets: string[];
      try {
        buckets = bucketsStr ? JSON.parse(bucketsStr) : IMAGE_BUCKETS.slice();
      } catch {
        buckets = ['uploads'];
      }

      return {
        type: (storageType || 'local') as 'local' | 'minio',
        local: {
          basePath: basePath || join(homedir(), '.luke', 'storage'),
          maxFileSizeMB: parseInt(maxFileSizeMBStr || '50', 10),
          buckets,
          enableProxy: enableProxyStr !== 'false',
        },
        minio: {
          endpoint: minioEndpoint || 'minio',
          port: parseInt(minioPortStr || '9000', 10),
          useSSL: minioUseSslStr === 'true',
          accessKey: minioAccessKey || '',
          secretKey: minioSecretKey || '',
          region: minioRegion || 'us-east-1',
          publicBaseUrl: minioPublicBaseUrl || '',
          presignedPutTtl: parseInt(minioPutTtlStr || '3600', 10),
          presignedGetTtl: parseInt(minioGetTtlStr || '3600', 10),
        },
      };
    }),

  saveConfig: protectedProcedure
    .use(requirePermission('config:update'))
    .use(withSectionAccess('settings'))
    .input(SaveStorageConfigSchema)
    .mutation(async ({ input, ctx }) => {
      if (input.type === 'local') {
        const validated = localStorageConfigSchema.parse({
          basePath: input.basePath,
          maxFileSizeMB: input.maxFileSizeMB,
          buckets: input.buckets,
          enableProxy: input.enableProxy ?? true,
        });
        await Promise.all([
          saveConfig(ctx.prisma, 'storage.type', 'local', false),
          saveConfig(ctx.prisma, 'storage.local.basePath', validated.basePath, false),
          saveConfig(ctx.prisma, 'storage.local.maxFileSizeMB', validated.maxFileSizeMB.toString(), false),
          saveConfig(ctx.prisma, 'storage.local.buckets', JSON.stringify(validated.buckets), false),
          saveConfig(ctx.prisma, 'storage.local.enableProxy', String(validated.enableProxy), false),
        ]);
      } else {
        await Promise.all([
          saveConfig(ctx.prisma, 'storage.type', 'minio', false),
          saveConfig(ctx.prisma, 'storage.minio.endpoint', input.endpoint, false),
          saveConfig(ctx.prisma, 'storage.minio.port', input.port.toString(), false),
          saveConfig(ctx.prisma, 'storage.minio.useSSL', String(input.useSSL), false),
          saveConfig(ctx.prisma, 'storage.minio.accessKey', input.accessKey, true),
          saveConfig(ctx.prisma, 'storage.minio.secretKey', input.secretKey, true),
          saveConfig(ctx.prisma, 'storage.minio.region', input.region, false),
          saveConfig(ctx.prisma, 'storage.minio.publicBaseUrl', input.publicBaseUrl || '', false),
          saveConfig(ctx.prisma, 'storage.minio.presignedPutTtl', input.presignedPutTtl.toString(), false),
          saveConfig(ctx.prisma, 'storage.minio.presignedGetTtl', input.presignedGetTtl.toString(), false),
        ]);
      }

      resetStorageProvider();
      return { success: true };
    }),
});
