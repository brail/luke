import pLimit from 'p-limit';

/**
 * Max concurrent storage reads when fetching row images for an export.
 * Bounds peak memory when a layout has many distinct row pictures — an
 * unbounded Promise.all over hundreds of images was the root cause of the
 * COLLECTION_LAYOUT_EXPORT_XLSX production OOM.
 */
export const IMAGE_FETCH_CONCURRENCY = 8;

export function imageFetchLimiter() {
  return pLimit(IMAGE_FETCH_CONCURRENCY);
}
