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

/**
 * Builds a data URI from a buffer and its *known* content-type — never guessed from
 * a filename/key extension. The previous per-file `toDataUri(buf, key)` helpers
 * inferred the MIME from the key's suffix and returned `null` for `.webp` (pdfmake/
 * exceljs can't embed WebP), which silently dropped any row picture uploaded as
 * WebP from every export. `readAssetBuffer` (`services/asset.service.ts`) already
 * resolves the `export` variant, whose pipeline guarantees PNG or JPEG output — so
 * by the time a buffer reaches this function there is no WebP case left to handle.
 */
export function bufferToDataUri(buf: Buffer, contentType: string): string {
  return `data:${contentType};base64,${buf.toString('base64')}`;
}

/** ExcelJS only accepts these three; the `export` variant's pipeline never produces anything else (`format: 'auto'` picks PNG or JPEG — see `deriveVariant`). */
export function extensionForExcelJs(contentType: string): 'jpeg' | 'png' | 'gif' {
  return contentType === 'image/png' ? 'png' : 'jpeg';
}
