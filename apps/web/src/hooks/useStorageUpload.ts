'use client';

import { useSession } from 'next-auth/react';
import { useCallback, useState } from 'react';

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

/** Options accepted by `useStorageUpload`. */
export interface UseStorageUploadOptions {
  /**
   * The API upload route, e.g. `buildCompanyLogoUploadUrl()`. Its response must contain
   * `{ publicUrl, fileObjectId }`.
   */
  url: string;
}

/** Return value of `useStorageUpload`: the upload function plus its in-flight state. */
export interface UseStorageUploadReturn {
  upload: (file: File) => Promise<StorageUploadResult>;
  isUploading: boolean;
  progress: number;
}

/**
 * Uploads a file as a multipart POST to an API upload route. The browser never talks to
 * storage directly: the storage service is not reachable from it (on 3.0 SeaweedFS sits on an
 * internal network), and the presigned PUT this hook used to send failed in production on CORS.
 *
 * @throws {Error} When the upload request fails.
 */
export function useStorageUpload({ url }: UseStorageUploadOptions): UseStorageUploadReturn {
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const { data: session } = useSession();

  const upload = useCallback(async (file: File): Promise<StorageUploadResult> => {
    setIsUploading(true);
    setProgress(0);

    try {
      const formData = new globalThis.FormData();
      formData.append('file', file);

      const headers: Record<string, string> = {};
      if (session?.accessToken) {
        headers['Authorization'] = `Bearer ${session.accessToken}`;
      }

      setProgress(30);
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: formData,
      });

      if (!res.ok) {
        // The route answers `{ error, message }`; `status` lets `getTrpcErrorMessage` map the
        // refusal the way it maps a tRPC error.
        const body: { message?: unknown } = await res.json().catch(() => ({}));
        const message = typeof body.message === 'string' ? body.message : `Upload fallito (${res.status})`;
        throw Object.assign(new Error(message), { status: res.status });
      }

      const data = await res.json();
      setProgress(100);
      return {
        publicUrl: data.publicUrl,
        fileObjectId: data.fileObjectId,
        key: data.key,
      };
    } finally {
      setIsUploading(false);
    }
  }, [url, session]);

  return { upload, isUploading, progress };
}
