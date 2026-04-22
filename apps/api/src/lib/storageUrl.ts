import type { PrismaClient } from '@prisma/client';

import { getPublicUrl, getProxyUrl, type StorageBucket, type UrlConfig } from '@luke/core';

import { getConfig } from './configManager';

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

export async function resolvePublicUrl(
  prisma: PrismaClient,
  bucket: StorageBucket,
  key: string,
): Promise<string> {
  const resolve = await makeUrlResolver(prisma);
  return resolve(bucket, key);
}
