/**
 * tRPC router for Storage
 *
 * Procedures for storage file management with RBAC and AuditLog
 */

import { randomUUID } from 'crypto';
import { homedir } from 'os';
import { join } from 'path';

import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { APP_STORAGE_BUCKETS, isValidBucket, storageSaveConfigSchema, type StorageBucket } from '@luke/core';

import { getConfig, saveConfig } from '../lib/configManager';
import { requirePermission } from '../lib/permissions';
import { withSectionAccess } from '../lib/sectionAccessMiddleware';
import { getStorageBaseUrl, resolvePublicUrl } from '../lib/storageUrl';
import { router, protectedProcedure } from '../lib/trpc';
import { getObjectMetadata, listObjects, deleteObject, resetStorageProvider, getStorageProvider, loadS3Provider } from '../storage';
import { signDownloadToken, signUploadToken, verifyUploadToken } from '../utils/downloadToken';

/**
 * Schema for list files
 */
const ListFilesSchema = z.object({
  bucket: z.string().optional(),
  limit: z.number().int().positive().max(100).optional(),
  cursor: z.string().optional(),
});

/**
 * Schema for delete file
 */
const DeleteFileSchema = z.object({
  id: z.string().uuid(),
});

/**
 * Schema for get download link
 */
const GetDownloadLinkSchema = z.object({
  id: z.string().uuid(),
});

/**
 * Schema for create upload
 */
const CreateUploadSchema = z.object({
  bucket: z.enum(APP_STORAGE_BUCKETS),
  originalName: z.string().min(1).max(255),
  contentType: z.string().optional(),
  size: z.number().int().positive(),
});

const RequestUploadSchema = z.object({
  bucket: z.enum(APP_STORAGE_BUCKETS),
  contentType: z.string().min(1),
  size: z.number().int().positive(),
  originalName: z.string().min(1).max(255),
});

const ConfirmUploadSchema = z.object({
  /** Token signed by `requestUpload`: carries bucket, key and user. */
  uploadToken: z.string().min(1),
  contentType: z.string().min(1),
  size: z.number().int().positive(),
  originalName: z.string().min(1).max(255),
  checksumSha256: z.string().optional(),
});

/**
 * Storage Router
 */
export const storageRouter = router({
  /**
   * Lists stored file objects with optional bucket filter and cursor-based pagination.
   *
   * @auth {config:read}
   * @input {ListFilesSchema} — optional: bucket, limit, cursor.
   * @output {{ items: FileObjectMetadata[], nextCursor: string | null }}
   */
  list: protectedProcedure
    .use(requirePermission('config:read'))
    .input(ListFilesSchema)
    .query(async ({ input, ctx }) => {
      // Validate bucket if specified
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
   * Returns metadata for a single file object; enforces ownership or admin/editor role.
   *
   * @auth {authenticated (ownership or admin/editor)}
   * @input {GetDownloadLinkSchema} — { id: string (UUID) }
   * @output {FileObjectMetadata}
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

      // Verify ownership or admin/editor
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
   * Issues a signed download URL (TTL 5 min) for a file object; enforces ownership or admin/editor role.
   *
   * @auth {authenticated (ownership or admin/editor)}
   * @input {GetDownloadLinkSchema} — { id: string (UUID) }
   * @output {{ url: string, expiresIn: 300 }}
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

      // Verify ownership or admin/editor
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

      // Generate signed token (TTL 5 minutes)
      const token = signDownloadToken({
        bucket: metadata.bucket,
        key: metadata.key,
      });

      // Build URL using the same base configured for the storage proxy
      const baseUrl = await getStorageBaseUrl(ctx.prisma);
      const downloadUrl = `${baseUrl}/storage/download?token=${token}`;

      return {
        url: downloadUrl,
        expiresIn: 300, // 5 minutes in seconds
      };
    }),

  /**
   * Requests an upload slot; returns a presigned PUT URL for S3-compatible storage or proxy fallback info for local storage.
   *
   * @auth {authenticated}
   * @input {RequestUploadSchema} — bucket, contentType, size, originalName, optional key.
   * @output {{ method: "presigned" | "proxy", presignedUrl, key, expiresAt }}
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
        // The server chooses the key. It used to be `input.key ?? <generated>`, i.e.
        // the client could preallocate it — and `confirmUpload` picked it back up
        // from the input without verifying it.
        const key = `${year}/${month}/${day}/${randomUUID()}${ext}`;

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
          // Binds the slot to bucket+key+user. TTL aligned with the presigned URL:
          // a slow upload shouldn't outlive the URL but should die at confirmation.
          uploadToken: signUploadToken({
            bucket: input.bucket as StorageBucket,
            key,
            userId: ctx.session.user.id,
            ttlMs: Math.max(expiresAt.getTime() - Date.now(), 0),
          }),
        };
      }

      // Local storage: caller should use entity-specific upload endpoint
      return {
        method: 'proxy' as const,
        uploadToken: null,
        presignedUrl: null,
        key: null,
        expiresAt: null,
      };
    }),

  /**
   * Confirms a completed presigned upload and creates the FileObject DB record; only needed for the S3 path.
   *
   * @auth {authenticated}
   * @input {ConfirmUploadSchema} — bucket, key, contentType, size, originalName, optional checksumSha256.
   * @output {{ fileId: string, publicUrl: string, key: string }}
   */
  confirmUpload: protectedProcedure
    .input(ConfirmUploadSchema)
    .mutation(async ({ input, ctx }) => {
      // Bucket and key come from the signed token, not from the input. They used to be
      // free-form fields: with the key of a blob uploaded by someone else, you could get
      // a `FileObject` created with your own `createdBy`, and from there the
      // `confirmPendingFile` predicate would let you link it as your own file.
      let slot;
      try {
        slot = verifyUploadToken(input.uploadToken);
      } catch {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Slot di upload non valida o scaduta, ricarica il file',
        });
      }

      if (slot.userId !== ctx.session.user.id) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Slot di upload assegnata a un altro utente',
        });
      }

      const publicUrl = await resolvePublicUrl(ctx.prisma, slot.bucket, slot.key);

      const fileObject = await ctx.prisma.fileObject.create({
        data: {
          id: randomUUID(),
          bucket: slot.bucket,
          key: slot.key,
          originalName: input.originalName,
          size: input.size,
          contentType: input.contentType,
          checksumSha256: input.checksumSha256 ?? '',
          createdBy: ctx.session.user.id,
          // Pending, not confirmed: this confirms the **transfer**, not the
          // linking to an entity. Whoever links it calls `confirmPendingFile`,
          // which requires `confirmedAt === null`. Welcome side effect: an
          // abandoned upload ends up under the hourly reaper instead of staying
          // forever.
          confirmedAt: null,
        },
      });

      return {
        fileObjectId: fileObject.id,
        publicUrl,
        key: slot.key,
      };
    }),

  /**
   * Legacy upload slot endpoint — generates an uploadId and proxy URL; use requestUpload for new code.
   *
   * @auth {authenticated}
   * @input {CreateUploadSchema} — bucket, originalName, contentType, size.
   * @output {{ uploadId: string, uploadUrl: string, bucket: string, maxSizeBytes: number }}
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
      const baseUrl = await getStorageBaseUrl(ctx.prisma);
      const uploadUrl = `${baseUrl}/storage/upload/${uploadId}`;

      return {
        uploadId,
        uploadUrl,
        bucket: input.bucket,
        maxSizeBytes,
      };
    }),

  /**
   * Deletes a file object and its underlying storage object.
   *
   * @auth {config:update}
   * @input {DeleteFileSchema} — { id: string (UUID) }
   * @output {{ success: true, message: string }}
   */
  delete: protectedProcedure
    .use(requirePermission('config:update'))
    .input(DeleteFileSchema)
    .mutation(async ({ input, ctx }) => {
      // Verify existence
      const metadata = await getObjectMetadata(ctx.prisma, input.id);
      if (!metadata) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'File non trovato',
        });
      }

      // Delete file and metadata
      await deleteObject(ctx, input.id);

      return {
        success: true,
        message: 'File cancellato con successo',
      };
    }),

  /**
   * Tests the currently saved S3 configuration by listing the uploads bucket and generating a test presigned URL.
   *
   * @auth {config:read}
   * @input {none}
   * @output {{ success: true, message: string, presignedUrlBase: string }}
   */
  testS3Connection: protectedProcedure
    .use(requirePermission('config:read'))
    .mutation(async ({ ctx }) => {
      const storageType = await getConfig(ctx.prisma, 'storage.type', false);
      if (storageType !== 's3') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Provider attuale non è S3. Salva prima la configurazione S3.',
        });
      }

      let provider;
      try {
        provider = await loadS3Provider(ctx.prisma);
      } catch (err: unknown) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Errore caricamento config storage S3: ${err instanceof Error ? err.message : String(err)}`,
          cause: err,
        });
      }

      // Verify connectivity by listing a bucket
      try {
        await provider.list({ bucket: 'uploads', limit: 1 });
      } catch (err: unknown) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Connessione allo storage S3 fallita: ${err instanceof Error ? err.message : String(err)}`,
          cause: err,
        });
      }

      // Generate a test presigned URL to show the base URL the browser will receive
      const presignResult = await provider.getPresignedPutUrl!({
        bucket: 'uploads',
        key: '_test/probe.jpg',
        contentType: 'image/jpeg',
        size: 1,
      });
      const presignedUrlBase = new URL(presignResult.url).origin;

      // Without a publicBaseUrl, presigned URLs fall back to the internal endpoint
      // (see S3Provider constructor) — which is normally a Docker-internal hostname
      // the browser can't resolve. Surface that as a known fact, not a guess the
      // frontend has to make by pattern-matching the hostname string.
      const publicBaseUrl = await getConfig(ctx.prisma, 'storage.s3.publicBaseUrl', false);

      return {
        success: true,
        message: 'Connessione storage S3 riuscita',
        presignedUrlBase,
        publicBaseUrlConfigured: !!publicBaseUrl,
      };
    }),

  /**
   * Returns the current storage configuration (local or S3), with sensitive credentials decrypted.
   *
   * @auth {config:read}
   * @input {none}
   * @output {{ type: "local" | "s3", local: {...}, s3: {...} }}
   */
  getConfig: protectedProcedure
    .use(requirePermission('config:read'))
    .use(withSectionAccess('settings'))
    .query(async ({ ctx }) => {
      const [
        storageType,
        basePath, maxFileSizeMBStr, enableProxyStr,
        s3Endpoint, s3PortStr, s3UseSslStr, s3AccessKey, s3SecretKey,
        s3Region, s3PublicBaseUrl, s3PutTtlStr, s3GetTtlStr,
      ] = await Promise.all([
        getConfig(ctx.prisma, 'storage.type', false),
        getConfig(ctx.prisma, 'storage.local.basePath', false),
        getConfig(ctx.prisma, 'storage.local.maxFileSizeMB', false),
        getConfig(ctx.prisma, 'storage.local.enableProxy', false),
        getConfig(ctx.prisma, 'storage.s3.endpoint', false),
        getConfig(ctx.prisma, 'storage.s3.port', false),
        getConfig(ctx.prisma, 'storage.s3.useSSL', false),
        getConfig(ctx.prisma, 'storage.s3.accessKey', true),
        getConfig(ctx.prisma, 'storage.s3.secretKey', true),
        getConfig(ctx.prisma, 'storage.s3.region', false),
        getConfig(ctx.prisma, 'storage.s3.publicBaseUrl', false),
        getConfig(ctx.prisma, 'storage.s3.presignedPutTtl', false),
        getConfig(ctx.prisma, 'storage.s3.presignedGetTtl', false),
      ]);

      return {
        type: (storageType || 'local') as 'local' | 's3',
        local: {
          basePath: basePath || join(homedir(), '.luke', 'storage'),
          maxFileSizeMB: parseInt(maxFileSizeMBStr || '50', 10),
          enableProxy: enableProxyStr !== 'false',
        },
        s3: {
          endpoint: s3Endpoint || 'seaweedfs',
          port: parseInt(s3PortStr || '8333', 10),
          useSSL: s3UseSslStr === 'true',
          accessKey: s3AccessKey || '',
          secretKey: s3SecretKey || '',
          region: s3Region || 'us-east-1',
          publicBaseUrl: s3PublicBaseUrl || '',
          presignedPutTtl: parseInt(s3PutTtlStr || '3600', 10),
          presignedGetTtl: parseInt(s3GetTtlStr || '3600', 10),
        },
      };
    }),

  /**
   * Saves the storage configuration (local or S3) to AppConfig and resets the storage provider singleton.
   *
   * @auth {config:update}
   * @input {storageSaveConfigSchema} — discriminated union of local or s3 config.
   * @output {{ success: true }}
   */
  saveConfig: protectedProcedure
    .use(requirePermission('config:update'))
    .use(withSectionAccess('settings'))
    .input(storageSaveConfigSchema)
    .mutation(async ({ input, ctx }) => {
      if (input.type === 'local') {
        await Promise.all([
          saveConfig(ctx.prisma, 'storage.type', 'local', false),
          saveConfig(ctx.prisma, 'storage.local.basePath', input.basePath, false),
          saveConfig(ctx.prisma, 'storage.local.maxFileSizeMB', input.maxFileSizeMB.toString(), false),
          saveConfig(ctx.prisma, 'storage.local.enableProxy', String(input.enableProxy), false),
        ]);
      } else {
        await Promise.all([
          saveConfig(ctx.prisma, 'storage.type', 's3', false),
          saveConfig(ctx.prisma, 'storage.s3.endpoint', input.endpoint, false),
          saveConfig(ctx.prisma, 'storage.s3.port', input.port.toString(), false),
          saveConfig(ctx.prisma, 'storage.s3.useSSL', String(input.useSSL), false),
          saveConfig(ctx.prisma, 'storage.s3.accessKey', input.accessKey, true),
          saveConfig(ctx.prisma, 'storage.s3.secretKey', input.secretKey, true),
          saveConfig(ctx.prisma, 'storage.s3.region', input.region, false),
          saveConfig(ctx.prisma, 'storage.s3.publicBaseUrl', input.publicBaseUrl || '', false),
          saveConfig(ctx.prisma, 'storage.s3.presignedPutTtl', input.presignedPutTtl.toString(), false),
          saveConfig(ctx.prisma, 'storage.s3.presignedGetTtl', input.presignedGetTtl.toString(), false),
        ]);
      }

      resetStorageProvider();
      return { success: true };
    }),
});
