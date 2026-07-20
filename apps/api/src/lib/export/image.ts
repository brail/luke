
import { extractBucketFromUrl, extractKeyFromUrl } from '@luke/core';

import { readFileBuffer } from '../../storage';

import type { PrismaClient } from '@prisma/client';

/**
 * Fetches a remote image and returns its raw bytes.
 *
 * @param timeoutMs - Request timeout in milliseconds. Defaults to 5000.
 * @returns Buffer with the image bytes, or `null` if the request fails or times out.
 */
export async function fetchImageAsBuffer(url: string, timeoutMs = 5000): Promise<Buffer | null> {
  try {
    const res = await fetch(url, { signal: globalThis.AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    const ab = await res.arrayBuffer();
    return Buffer.from(ab);
  } catch {
    return null;
  }
}

/**
 * Fetches a remote image and returns it as a base64-encoded string.
 *
 * @param timeoutMs - Request timeout in milliseconds. Defaults to 5000.
 * @returns Base64 string, or `null` on failure.
 */
export async function fetchImageAsBase64(url: string, timeoutMs = 5000): Promise<string | null> {
  const buf = await fetchImageAsBuffer(url, timeoutMs);
  if (!buf) return null;
  return buf.toString('base64');
}

/** Returns a complete data URI including the correct MIME type from the HTTP response. */
export async function fetchImageAsDataUri(url: string, timeoutMs = 5000): Promise<string | null> {
  try {
    const res = await fetch(url, { signal: globalThis.AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    const mimeType = (res.headers.get('content-type') ?? 'image/jpeg').split(';')[0].trim();
    const base64 = Buffer.from(await res.arrayBuffer()).toString('base64');
    return `data:${mimeType};base64,${base64}`;
  } catch {
    return null;
  }
}

/**
 * Reads an image from local storage for proxy URLs (`/api/uploads/...`)
 * or falls back to an HTTP fetch for absolute URLs (e.g. production with a public base URL).
 *
 * @returns Buffer with image bytes, or `null` if the image cannot be retrieved.
 */
export async function fetchImageBufferFromUrl(
  url: string,
  prisma: PrismaClient,
): Promise<Buffer | null> {
  const bucket = extractBucketFromUrl(url);
  const key = extractKeyFromUrl(url);
  if (bucket && key) {
    return readFileBuffer(prisma, bucket, key);
  }
  return fetchImageAsBuffer(url);
}

/**
 * Same as `fetchImageBufferFromUrl` but returns a data URI suitable for pdfmake.
 * MIME type is read from the `FileObject` database record when available,
 * falling back to `image/jpeg`.
 *
 * @returns Data URI string (e.g. `data:image/png;base64,...`), or `null` on failure.
 */
export async function fetchImageDataUriFromUrl(
  url: string,
  prisma: PrismaClient,
): Promise<string | null> {
  const bucket = extractBucketFromUrl(url);
  const key = extractKeyFromUrl(url);
  if (bucket && key) {
    const [buf, meta] = await Promise.all([
      readFileBuffer(prisma, bucket, key),
      prisma.fileObject.findFirst({ where: { bucket, key }, select: { contentType: true } }),
    ]);
    if (!buf) return null;
    const mime = meta?.contentType ?? 'image/jpeg';
    return `data:${mime};base64,${buf.toString('base64')}`;
  }
  return fetchImageAsDataUri(url);
}
