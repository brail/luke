
import { getPublicUrl, getProxyUrl, type StorageBucket, type UrlConfig } from '@luke/core';
import type { PrismaClient } from '@luke/db';

import { getConfig, getConfigOrDefault } from './configManager';


/**
 * Reads the storage URL configuration from AppConfig and returns a `UrlConfig` object
 * suitable for passing to `@luke/core` URL builder functions.
 */
export async function getStorageUrlConfig(
  prisma: PrismaClient
): Promise<UrlConfig> {
  const [publicBaseUrl, enableProxy] = await Promise.all([
    getConfig(prisma, 'storage.local.publicBaseUrl', false),
    getConfigOrDefault(prisma, 'storage.local.enableProxy'),
  ]);

  return {
    publicBaseUrl: publicBaseUrl || undefined,
    enableProxy,
  };
}

/**
 * Returns a sync URL resolver pre-loaded with the current storage config.
 * Use this when resolving many keys at once to avoid redundant DB reads.
 */
export async function makeUrlResolver(
  prisma: PrismaClient,
): Promise<(bucket: StorageBucket, key: string) => string> {
  const storageType = await getConfigOrDefault(prisma, 'storage.type');

  if (storageType === 's3') {
    // S3-compatible assets are served via the authenticated proxy route /api/uploads/{bucket}/{key}.
    // Buckets remain private; the Next.js route handler enforces authentication.
    return (bucket, key) => getProxyUrl(bucket, key);
  }

  const urlConfig = await getStorageUrlConfig(prisma);
  return (bucket, key) => getPublicUrl(bucket, key, urlConfig);
}

/**
 * Resolves the public URL for a single storage object.
 * Convenience wrapper around `makeUrlResolver` for one-off lookups.
 */
export async function resolvePublicUrl(
  prisma: PrismaClient,
  bucket: StorageBucket,
  key: string,
): Promise<string> {
  const resolve = await makeUrlResolver(prisma);
  return resolve(bucket, key);
}
