import sharp from 'sharp';

type Logger = { warn: (obj: object, msg: string) => void };

/** Target boxes are requested at this multiple of the display size, for retina/print sharpness. */
export const EMBED_OVERSAMPLE_FACTOR = 2;

/**
 * Downscales an image buffer to fit within maxWidth×maxHeight (never upscales,
 * preserves aspect ratio and original format). Returns `null` when sharp cannot
 * decode the source — the caller drops that one picture and the export still
 * succeeds.
 *
 * Deliberately the opposite of `normalizeMaster`'s fallback (`lib/assets/pipeline.ts`),
 * which keeps the original bytes: that runs on upload, where the buffer is already
 * bounded by the storage size cap and refusing it would fail the user's upload.
 * This runs on export, where buffers accumulate across every row of a layout and
 * `readAssetBuffer` may hand over a full-size master (the `export` variant is
 * generated in the background, so a freshly uploaded photo has none yet).
 * Re-embedding an undecodable buffer there reopens the v2.0.0 OOM path to pay for
 * bytes that exceljs/pdfmake cannot render either — same call `readAssetBuffer`
 * already makes for a WebP master: better no picture than a broken one.
 */
export async function resizeForEmbed(
  buf: Buffer,
  maxWidthPx: number,
  maxHeightPx: number,
  logger?: Logger,
): Promise<Buffer | null> {
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
    logger?.warn({ err }, 'image resize for export failed, dropping the picture');
    return null;
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
