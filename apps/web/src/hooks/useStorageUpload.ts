'use client';

import { useSession } from 'next-auth/react';
import { useCallback, useState } from 'react';

import { type APP_STORAGE_BUCKETS } from '@luke/core';

import { trpc } from '../lib/trpc';

/** Result of a completed upload: the public URL plus the id needed to link the file to an entity. */
export interface StorageUploadResult {
  publicUrl: string;
  /**
   * Id of the `FileObject` to pass to the mutation that links the file to the entity.
   *
   * Used to be called `fileId`, while the dedicated upload endpoints (brand temp,
   * collection row) returned `fileObjectId`: three names for the same thing. Now
   * there's just one.
   */
  fileObjectId: string;
  key?: string;
}

/** Upload-facing buckets only — excludes internal/private buckets like "backups". */
export type UploadableBucket = (typeof APP_STORAGE_BUCKETS)[number];

/** Options accepted by `useStorageUpload`. */
export interface UseStorageUploadOptions {
  /**
   * Fallback URL to use when storage is in proxy (local) mode.
   * Should be an absolute API URL like buildBrandLogoUploadUrl(id).
   * The response from this URL must contain `{ publicUrl: string }`.
   */
  fallbackProxyUrl?: string;
  /** Additional multipart form fields for the proxy upload */
  extraFields?: Record<string, string>;
}

/** Return value of `useStorageUpload`: the upload function plus its in-flight state. */
export interface UseStorageUploadReturn {
  upload: (file: File, bucket: UploadableBucket) => Promise<StorageUploadResult>;
  isUploading: boolean;
  progress: number;
}

/**
 * Uploads a file to storage, picking the transport based on what
 * `storage.requestUpload` responds with: a direct presigned PUT (MinIO) when
 * `req.method === 'presigned'`, otherwise a multipart POST to `fallbackProxyUrl`
 * (local proxy mode).
 *
 * @throws {Error} When the proxy path is required but no `fallbackProxyUrl` was
 *   provided, or when the upload request itself fails.
 */
export function useStorageUpload(options: UseStorageUploadOptions = {}): UseStorageUploadReturn {
  const { fallbackProxyUrl, extraFields } = options;
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const { data: session } = useSession();

  const requestUpload = trpc.storage.requestUpload.useMutation();
  const confirmUpload = trpc.storage.confirmUpload.useMutation();

  const upload = useCallback(async (file: File, bucket: UploadableBucket): Promise<StorageUploadResult> => {
    setIsUploading(true);
    setProgress(0);

    try {
      const req = await requestUpload.mutateAsync({
        bucket,
        contentType: file.type || 'application/octet-stream',
        size: file.size,
        originalName: file.name,
      });

      if (req.method === 'presigned' && req.presignedUrl && req.key && req.uploadToken) {
        // MinIO path: PUT directly to presigned URL
        setProgress(20);
        const putRes = await fetch(req.presignedUrl, {
          method: 'PUT',
          body: file,
          headers: { 'Content-Type': file.type || 'application/octet-stream' },
        });

        if (!putRes.ok) {
          throw new Error(`Upload to storage failed (${putRes.status})`);
        }

        setProgress(80);
        // Bucket e key non si rimandano: li porta il token, che il server ha
        // firmato quando ha allocato la slot.
        const confirmed = await confirmUpload.mutateAsync({
          uploadToken: req.uploadToken,
          contentType: file.type || 'application/octet-stream',
          size: file.size,
          originalName: file.name,
        });

        setProgress(100);
        return {
          publicUrl: confirmed.publicUrl,
          fileObjectId: confirmed.fileObjectId,
          key: confirmed.key,
        };
      }

      // Local proxy path: POST multipart to entity-specific endpoint
      if (!fallbackProxyUrl) {
        throw new Error('Storage is in proxy mode but no fallbackProxyUrl was provided');
      }

      const formData = new globalThis.FormData();
      formData.append('file', file);
      if (extraFields) {
        for (const [k, v] of Object.entries(extraFields)) {
          formData.append(k, v);
        }
      }

      const headers: Record<string, string> = {};
      if (session?.accessToken) {
        headers['Authorization'] = `Bearer ${session.accessToken}`;
      }

      setProgress(30);
      const proxyRes = await fetch(fallbackProxyUrl, {
        method: 'POST',
        headers,
        body: formData,
      });

      if (!proxyRes.ok) {
        throw new Error(`Upload failed (${proxyRes.status})`);
      }

      const data = await proxyRes.json();
      setProgress(100);
      return {
        publicUrl: data.publicUrl,
        fileObjectId: data.fileObjectId,
        key: data.key,
      };
    } finally {
      setIsUploading(false);
    }
  }, [requestUpload, confirmUpload, fallbackProxyUrl, extraFields, session]);

  return { upload, isUploading, progress };
}
