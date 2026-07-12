
import { getPublicUrl, getProxyUrl, type StorageBucket, type UrlConfig } from '@luke/core';

import { getConfig } from './configManager';

import type { PrismaClient } from '@prisma/client';

/**
 * Reads the storage URL configuration from AppConfig and returns a `UrlConfig` object
 * suitable for passing to `@luke/core` URL builder functions.
 */
export async function getStorageUrlConfig(
  prisma: PrismaClient
): Promise<UrlConfig> {
  const publicBaseUrl = await getConfig(prisma, 'storage.local.publicBaseUrl', false);
  const enableProxyStr = await getConfig(prisma, 'storage.local.enableProxy', false);
  const enableProxy = enableProxyStr ? enableProxyStr === 'true' : true;

  return {
    publicBaseUrl: publicBaseUrl || undefined,
    enableProxy,
  };
}

/**
 * Resolves the absolute base URL for building storage download/upload links.
 * Fallback chain when `storage.local.publicBaseUrl` is unset: the configured
 * `app.baseUrl` from AppConfig, then the local API address (dev without seeded
 * config) — centralized here so callers don't each redefine the fallback.
 */
export async function getStorageBaseUrl(prisma: PrismaClient): Promise<string> {
  const { publicBaseUrl } = await getStorageUrlConfig(prisma);
  if (publicBaseUrl) return publicBaseUrl;
  const appBaseUrl = await getConfig(prisma, 'app.baseUrl', false);
  return appBaseUrl || `http://localhost:${process.env.PORT || 3001}`;
}

/**
 * Returns a sync URL resolver pre-loaded with the current storage config.
 * Use this when resolving many keys at once to avoid redundant DB reads.
 */
export async function makeUrlResolver(
  prisma: PrismaClient,
): Promise<(bucket: StorageBucket, key: string) => string> {
  const storageType = (await getConfig(prisma, 'storage.type', false)) || 'local';

  if (storageType === 'minio') {
    // MinIO assets are served via the authenticated proxy route /api/uploads/{bucket}/{key}.
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
