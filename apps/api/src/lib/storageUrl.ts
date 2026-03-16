/**
 * Utility condivisa per la configurazione URL dello storage.
 * Evita la duplicazione di getUrlConfig tra i vari service.
 */

import type { PrismaClient } from '@prisma/client';

import type { UrlConfig } from '@luke/core';

import { getConfig } from './configManager';

export async function getStorageUrlConfig(
  prisma: PrismaClient
): Promise<UrlConfig> {
  const publicBaseUrl = await getConfig(
    prisma,
    'storage.local.publicBaseUrl',
    false
  );
  const enableProxyStr = await getConfig(
    prisma,
    'storage.local.enableProxy',
    false
  );
  const enableProxy = enableProxyStr ? enableProxyStr === 'true' : true;

  return {
    publicBaseUrl: publicBaseUrl || undefined,
    enableProxy,
  };
}
