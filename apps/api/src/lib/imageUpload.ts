import path from 'path';

import { TRPCError } from '@trpc/server';

/**
 * Collects all chunks from a readable stream into a single `Buffer`.
 */
export async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

const IMAGE_MAGIC_BYTES: Record<string, string[]> = {
  'image/png': ['89504e47'],
  'image/jpeg': ['ffd8ffe0', 'ffd8ffe1', 'ffd8ffe2'],
  'image/jpg': ['ffd8ffe0', 'ffd8ffe1', 'ffd8ffe2'],
  'image/webp': ['52494646'], // RIFF header
};

/**
 * Validates that a buffer's leading bytes match the expected magic numbers for
 * the given MIME type. Guards against file extension spoofing.
 *
 * @returns `true` if the buffer starts with a known magic byte sequence for the MIME type.
 */
export function validateMagicBytes(buffer: Buffer, mimetype: string): boolean {
  const magicBytes = buffer.slice(0, 4).toString('hex');
  const expected = IMAGE_MAGIC_BYTES[mimetype];
  if (!expected) return false;
  return expected.some(e => magicBytes.startsWith(e));
}

/**
 * Validates an uploaded image file against MIME type, size, and extension constraints.
 * Sanitises the filename by stripping special characters.
 *
 * @param file - File metadata from the multipart upload.
 * @param config - Upload constraints (allowed MIME types, max size, allowed extensions).
 * @returns Sanitised filename (basename only, no path traversal).
 * @throws {TRPCError} `BAD_REQUEST` if the file fails any validation constraint.
 */
export function validateImageFile(
  file: { mimetype: string; size: number; filename: string },
  config: { allowedMimes: readonly string[]; maxSizeBytes: number; allowedExtensions: readonly string[] }
): string {
  if (!config.allowedMimes.includes(file.mimetype)) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `Tipo file non supportato. Usa: ${config.allowedMimes.join(', ')}`,
    });
  }

  if (file.size > config.maxSizeBytes) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `File troppo grande. Max ${Math.round(config.maxSizeBytes / 1024 / 1024)}MB`,
    });
  }

  const sanitizedFilename = path
    .basename(file.filename)
    .replace(/[^a-zA-Z0-9._-]/g, '_');
  const ext = path.extname(sanitizedFilename).toLowerCase();

  if (!config.allowedExtensions.includes(ext)) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `Estensione file non valida. Usa: ${config.allowedExtensions.join(', ')}`,
    });
  }

  return sanitizedFilename;
}
