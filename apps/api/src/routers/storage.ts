/**
 * tRPC router for Storage
 *
 * Upload slots (`requestUpload`/`confirmUpload`), the S3 connection test and the storage
 * configuration.
 */

import { randomUUID } from 'crypto';
import { homedir } from 'os';
import { join } from 'path';

import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { PRESIGNED_UPLOAD_BUCKETS, storageSaveConfigSchema, type Permission, type StorageBucket } from '@luke/core';

import { getConfig, getConfigOrDefault, saveConfigs } from '../lib/configManager';
import { requirePermission } from '../lib/permissions';
import { withSectionAccess } from '../lib/sectionAccessMiddleware';
import { resolvePublicUrl } from '../lib/storageUrl';
import { router, protectedProcedure } from '../lib/trpc';
import { resetStorageProvider, getStorageProvider, loadS3Provider } from '../storage';
import { signUploadToken, verifyUploadToken } from '../utils/downloadToken';

const RequestUploadSchema = z.object({
  bucket: z.enum(PRESIGNED_UPLOAD_BUCKETS),
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
 * The permission each presigned bucket needs: that of the procedure which links its files. Keyed on
 * the bucket list, so a new presigned bucket does not compile until it has one — and `confirmUpload`
 * must then check the verified slot's bucket, since its OR gate is exact only while there is one.
 */
const PRESIGNED_UPLOAD_PERMISSION = {
  'company-assets': 'company_profile:update', // company.update links the logo
} as const satisfies Record<(typeof PRESIGNED_UPLOAD_BUCKETS)[number], Permission>;

/**
 * Storage Router
 */
export const storageRouter = router({
  /**
   * Requests an upload slot; returns a presigned PUT URL for S3-compatible storage or proxy fallback info for local storage.
   *
   * @auth {the bucket's permission in `PRESIGNED_UPLOAD_PERMISSION`}
   * @input {RequestUploadSchema} — bucket (one of `PRESIGNED_UPLOAD_BUCKETS`), contentType, size, originalName.
   * @output {{ method: "presigned" | "proxy", presignedUrl, key, expiresAt, uploadToken }}
   */
  requestUpload: protectedProcedure
    .input(RequestUploadSchema)
    .use(requirePermission<z.infer<typeof RequestUploadSchema>>(input => PRESIGNED_UPLOAD_PERMISSION[input.bucket]))
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
   * @auth {any permission in `PRESIGNED_UPLOAD_PERMISSION`; the slot token binds bucket and user, and
   *   `requestUpload` signs it only after that bucket's own check}
   * @input {ConfirmUploadSchema} — uploadToken (carries bucket, key and user), contentType, size, originalName, optional checksumSha256.
   * @output {{ fileObjectId: string, publicUrl: string, key: string }}
   */
  confirmUpload: protectedProcedure
    .use(requirePermission(Object.values(PRESIGNED_UPLOAD_PERMISSION)))
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

      // A slot signed before the bucket list was narrowed stays valid until it expires.
      if (!z.enum(PRESIGNED_UPLOAD_BUCKETS).safeParse(slot.bucket).success) {
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
          // abandoned upload ends up under the pending-file reaper instead of staying
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
   * Returns the current storage configuration (local or S3): the S3 access key decrypted, and of the
   * secret key only whether one is stored, closing the case ADR-023 records under Observed gaps.
   *
   * @auth {config:read}
   * @input {none}
   * @output {{ type: "local" | "s3", local: {...}, s3: {...} }}
   */
  getConfig: protectedProcedure
    .use(requirePermission('config:read'))
    .use(withSectionAccess('settings.storage'))
    .query(async ({ ctx }) => {
      // Every fallback and coercion here used to be written out, and disagreed with the copy in
      // `storage/index.ts` that opens the actual connection — the page showed `seaweedfs` while
      // the provider dialled `localhost`. Both now read the one declaration.
      const [
        type,
        basePath, maxFileSizeMB, enableProxy,
        endpoint, port, useSSL, s3AccessKey, s3SecretKey,
        region, s3PublicBaseUrl, presignedPutTtl, presignedGetTtl,
      ] = await Promise.all([
        getConfigOrDefault(ctx.prisma, 'storage.type'),
        getConfig(ctx.prisma, 'storage.local.basePath', false),
        getConfigOrDefault(ctx.prisma, 'storage.local.maxFileSizeMB'),
        getConfigOrDefault(ctx.prisma, 'storage.local.enableProxy'),
        getConfigOrDefault(ctx.prisma, 'storage.s3.endpoint'),
        getConfigOrDefault(ctx.prisma, 'storage.s3.port'),
        getConfigOrDefault(ctx.prisma, 'storage.s3.useSSL'),
        getConfig(ctx.prisma, 'storage.s3.accessKey', true),
        getConfig(ctx.prisma, 'storage.s3.secretKey', false),
        getConfigOrDefault(ctx.prisma, 'storage.s3.region'),
        getConfig(ctx.prisma, 'storage.s3.publicBaseUrl', false),
        getConfigOrDefault(ctx.prisma, 'storage.s3.presignedPutTtl'),
        getConfigOrDefault(ctx.prisma, 'storage.s3.presignedGetTtl'),
      ]);

      return {
        type,
        local: {
          basePath: basePath || join(homedir(), '.luke', 'storage'),
          maxFileSizeMB,
          enableProxy,
        },
        s3: {
          endpoint,
          port,
          useSSL,
          // Blank, not the provider's dev fallback: this feeds a settings form, and offering a
          // credential the database does not hold invites an admin to save it as if it were real.
          accessKey: s3AccessKey || '',
          hasSecretKey: !!s3SecretKey,
          region,
          publicBaseUrl: s3PublicBaseUrl || '',
          presignedPutTtl,
          presignedGetTtl,
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
    .use(withSectionAccess('settings.storage'))
    .input(storageSaveConfigSchema)
    .mutation(async ({ input, ctx }) => {
      // One change: a failure leaves the stored storage settings as they were.
      if (input.type === 'local') {
        await saveConfigs(ctx.prisma, [
          { key: 'storage.type', value: 'local' },
          { key: 'storage.local.basePath', value: input.basePath },
          { key: 'storage.local.maxFileSizeMB', value: input.maxFileSizeMB.toString() },
          { key: 'storage.local.enableProxy', value: String(input.enableProxy) },
        ]);
      } else {
        // A blank secret keeps the stored one, since the page is never sent it; with none stored,
        // saving would switch to an S3 provider that cannot connect.
        const secretKey = input.secretKey || null;
        if (!secretKey && !(await getConfig(ctx.prisma, 'storage.s3.secretKey', false))) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Secret key richiesta' });
        }
        await saveConfigs(ctx.prisma, [
          { key: 'storage.type', value: 's3' },
          { key: 'storage.s3.endpoint', value: input.endpoint },
          { key: 'storage.s3.port', value: input.port.toString() },
          { key: 'storage.s3.useSSL', value: String(input.useSSL) },
          { key: 'storage.s3.accessKey', value: input.accessKey, encrypt: true },
          ...(secretKey ? [{ key: 'storage.s3.secretKey' as const, value: secretKey, encrypt: true }] : []),
          { key: 'storage.s3.region', value: input.region },
          // Left blank, the CDN base URL is absent, not an empty URL: `storage/index.ts` and the
          // two read paths in this router all treat a falsy value as "derive the URL from the
          // endpoint". Storing `''` would be a second spelling of that, and one the registry's
          // `z.string().url()` cannot describe.
          { key: 'storage.s3.publicBaseUrl', value: input.publicBaseUrl || null },
          { key: 'storage.s3.presignedPutTtl', value: input.presignedPutTtl.toString() },
          { key: 'storage.s3.presignedGetTtl', value: input.presignedGetTtl.toString() },
        ]);
      }

      resetStorageProvider();
      return { success: true };
    }),
});
