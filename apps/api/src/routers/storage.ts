/**
 * Router tRPC per Storage
 *
 * Procedure per gestione file storage con RBAC e AuditLog
 */

import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { isValidBucket, localStorageConfigSchema } from '@luke/core';

import { adminOnly, adminOrEditor } from '../lib/rbac';
import { router, protectedProcedure } from '../lib/trpc';
import { withSectionAccess } from '../lib/sectionAccessMiddleware';
import { getConfig, saveConfig } from '../lib/configManager';
import { getObjectMetadata, listObjects, deleteObject } from '../storage';
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

/**
 * Schema per create upload
 */
const CreateUploadSchema = z.object({
  bucket: z.enum(['uploads', 'exports', 'assets']),
  originalName: z.string().min(1).max(255),
  contentType: z.string().optional(),
  size: z.number().int().positive(),
});

/**
 * Schema per configurazione storage
 */
const SaveStorageConfigSchema = z.object({
  basePath: z.string().min(1),
  maxFileSizeMB: z.number().int().positive().min(1).max(1000),
  buckets: z.array(z.enum(['uploads', 'exports', 'assets'])),
});

/**
 * Router Storage
 */
export const storageRouter = router({
  /**
   * Lista file con paginazione
   * Accessibile a tutti gli utenti autenticati
   */
  list: protectedProcedure
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
        bucket: input.bucket as any,
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

      // Costruisci URL (assumendo server API su stesso host)
      const baseUrl =
        process.env.API_BASE_URL ||
        `http://localhost:${process.env.PORT || 3001}`;
      const downloadUrl = `${baseUrl}/storage/download?token=${token}`;

      return {
        url: downloadUrl,
        expiresIn: 300, // 5 minuti in secondi
      };
    }),

  /**
   * Prepara upload (genera uploadId e URL)
   * Accessibile a tutti gli utenti autenticati
   */
  createUpload: protectedProcedure
    .input(CreateUploadSchema)
    .mutation(async ({ input }) => {
      // Valida dimensione massima dal config
      // Per ora hardcoded a 50MB, poi da AppConfig
      const maxSizeMB = 50;
      const maxSizeBytes = maxSizeMB * 1024 * 1024;

      if (input.size > maxSizeBytes) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `File troppo grande. Massimo ${maxSizeMB}MB`,
        });
      }

      // Genera uploadId (sarà usato nella route multipart)
      const { randomUUID } = await import('crypto');
      const uploadId = randomUUID();

      // Salva metadato "pending" in cache/memoria (o ritorna solo uploadId)
      // Per semplicità, il multipart handler validerà l'uploadId e creerà il record

      // Costruisci URL upload
      const baseUrl =
        process.env.API_BASE_URL ||
        `http://localhost:${process.env.PORT || 3001}`;
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
    .use(adminOrEditor)
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

  /**
   * Ottieni configurazione storage locale
   * Solo admin
   */
  getConfig: protectedProcedure
    .use(adminOnly)
    .use(withSectionAccess('settings'))
    .query(async ({ ctx }) => {
      const [storageType, basePath, maxFileSizeMB, bucketsStr] =
        await Promise.all([
          getConfig(ctx.prisma, 'storage.type', false),
          getConfig(ctx.prisma, 'storage.local.basePath', false),
          getConfig(ctx.prisma, 'storage.local.maxFileSizeMB', false),
          getConfig(ctx.prisma, 'storage.local.buckets', false),
        ]);

      // Parse buckets
      let buckets: string[];
      try {
        buckets = bucketsStr ? JSON.parse(bucketsStr) : ['uploads'];
      } catch {
        buckets = ['uploads'];
      }

      return {
        type: storageType || 'local',
        basePath: basePath || '/tmp/luke-storage',
        maxFileSizeMB: parseInt(maxFileSizeMB || '50', 10),
        buckets,
      };
    }),

  /**
   * Salva configurazione storage locale
   * Solo admin
   */
  saveConfig: protectedProcedure
    .use(adminOnly)
    .use(withSectionAccess('settings'))
    .input(SaveStorageConfigSchema)
    .mutation(async ({ input, ctx }) => {
      // Valida con schema Zod
      const validatedConfig = localStorageConfigSchema.parse(input);

      // Salva in AppConfig
      await Promise.all([
        saveConfig(ctx.prisma, 'storage.type', 'local', false),
        saveConfig(
          ctx.prisma,
          'storage.local.basePath',
          validatedConfig.basePath,
          false
        ),
        saveConfig(
          ctx.prisma,
          'storage.local.maxFileSizeMB',
          validatedConfig.maxFileSizeMB.toString(),
          false
        ),
        saveConfig(
          ctx.prisma,
          'storage.local.buckets',
          JSON.stringify(validatedConfig.buckets),
          false
        ),
      ]);

      return {
        success: true,
        message: 'Configurazione storage salvata con successo',
      };
    }),
});
