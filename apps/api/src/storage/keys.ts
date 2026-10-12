import { randomUUID } from 'crypto';

import { calendarDateIn, extensionForContentType } from '@luke/core';

/**
 * A new server-side storage key, `YYYY/MM/DD/<uuid>[.ext]`: partitioned by the UTC day of `now`, so
 * the partition never depends on the zone of the process, and with the extension of `contentType`
 * when it is a known image type (`extensionForContentType`).
 */
export function generateStorageKey(contentType?: string, now: Date = new Date()): string {
  const extension = contentType ? extensionForContentType(contentType) : 'bin';
  return `${calendarDateIn(now, 'UTC').replaceAll('-', '/')}/${randomUUID()}${extension === 'bin' ? '' : `.${extension}`}`;
}
