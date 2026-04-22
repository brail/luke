import path from 'path';
import { TRPCError } from '@trpc/server';

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

export function validateMagicBytes(buffer: Buffer, mimetype: string): boolean {
  const magicBytes = buffer.slice(0, 4).toString('hex');
  const expected = IMAGE_MAGIC_BYTES[mimetype];
  if (!expected) return false;
  return expected.some(e => magicBytes.startsWith(e));
}

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
