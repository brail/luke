import sharp from 'sharp';

type Logger = { warn: (obj: object, msg: string) => void };

/** Target boxes are requested at this multiple of the display size, for retina/print sharpness. */
export const EMBED_OVERSAMPLE_FACTOR = 2;

/**
 * Downscales an image buffer to fit within maxWidth×maxHeight (never upscales,
 * preserves aspect ratio and original format). Falls back to the original
 * buffer if sharp fails to decode it (e.g. corrupt file) — export must not
 * fail because a single photo is bad.
 */
export async function resizeForEmbed(
  buf: Buffer,
  maxWidthPx: number,
  maxHeightPx: number,
  logger?: Logger,
): Promise<Buffer> {
  try {
    // sequentialRead matches this pipeline's actual access pattern (decode once,
    // resize, encode, discard) — keeps libvips from buffering more of a large
    // source photo than a single linear pass needs, which is the whole point here.
    const image = sharp(buf, { sequentialRead: true });
    const { width, height } = await image.metadata();
    if (width !== undefined && height !== undefined && width <= maxWidthPx && height <= maxHeightPx) {
      return buf;
    }
    return await image
      .resize({ width: maxWidthPx, height: maxHeightPx, fit: 'inside', withoutEnlargement: true })
      .toBuffer();
  } catch (err) {
    logger?.warn({ err }, 'image resize for export failed, embedding original buffer');
    return buf;
  }
}
