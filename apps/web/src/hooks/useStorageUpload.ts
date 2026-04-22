'use client';

import { useSession } from 'next-auth/react';
import { useCallback, useState } from 'react';

import type { StorageBucket } from '@luke/core';

import { trpc } from '../lib/trpc';

export interface StorageUploadResult {
  publicUrl: string;
  fileId: string;
  key?: string;
}

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

export interface UseStorageUploadReturn {
  upload: (file: File, bucket: StorageBucket) => Promise<StorageUploadResult>;
  isUploading: boolean;
  progress: number;
}

export function useStorageUpload(options: UseStorageUploadOptions = {}): UseStorageUploadReturn {
  const { fallbackProxyUrl, extraFields } = options;
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const { data: session } = useSession();

  const requestUpload = trpc.storage.requestUpload.useMutation();
  const confirmUpload = trpc.storage.confirmUpload.useMutation();

  const upload = useCallback(async (file: File, bucket: StorageBucket): Promise<StorageUploadResult> => {
    setIsUploading(true);
    setProgress(0);

    try {
      const req = await requestUpload.mutateAsync({
        bucket,
        contentType: file.type || 'application/octet-stream',
        size: file.size,
        originalName: file.name,
      });

      if (req.method === 'presigned' && req.presignedUrl && req.key) {
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
        const confirmed = await confirmUpload.mutateAsync({
          bucket,
          key: req.key,
          contentType: file.type || 'application/octet-stream',
          size: file.size,
          originalName: file.name,
        });

        setProgress(100);
        return { publicUrl: confirmed.publicUrl, fileId: confirmed.fileId, key: confirmed.key };
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
      return { publicUrl: data.publicUrl, fileId: data.fileId ?? '', key: data.key };
    } finally {
      setIsUploading(false);
    }
  }, [requestUpload, confirmUpload, fallbackProxyUrl, extraFields, session]);

  return { upload, isUploading, progress };
}
