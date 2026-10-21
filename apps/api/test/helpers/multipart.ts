import { createValidPngBuffer } from './storageTestHelper';

/** One part of a multipart body: a plain field, or a file with its name and media type. */
export type MultipartPart =
  | { name: string; value: string }
  | { name: string; file: Buffer; filename: string; type: string };

/**
 * A multipart/form-data request for `app.inject()`: no socket, the same Fastify lifecycle.
 *
 * The platform's encoder writes the body and its boundary (`FormData` serialized through
 * `Request`), and the body goes out whole. Not a `FormData` payload, which `inject` accepts but
 * streams chunked: that way the multipart suite no longer catches the `@fastify/multipart` 10.1.1
 * regression (checked 2026-10-21). Parts keep their order and a name may repeat.
 */
export async function multipartRequest(
  parts: MultipartPart[],
  headers: Record<string, string> = {}
): Promise<{ payload: Buffer; headers: Record<string, string> }> {
  const form = new FormData();
  for (const part of parts) {
    if ('value' in part) form.append(part.name, part.value);
    // A copy: `Buffer<ArrayBufferLike>` is not a `BlobPart`.
    else form.append(part.name, new Blob([new Uint8Array(part.file)], { type: part.type }), part.filename);
  }
  const request = new Request('http://localhost/', { method: 'POST', body: form });
  const contentType = request.headers.get('content-type');
  if (!contentType) throw new Error('FormData produced no content-type');
  return {
    payload: Buffer.from(await request.arrayBuffer()),
    headers: { ...headers, 'content-type': contentType },
  };
}

/** A PNG file part named `filename`, by default a minimal valid image. */
export function pngPart(filename: string, file = createValidPngBuffer()): MultipartPart {
  return { name: 'file', file, filename, type: 'image/png' };
}
