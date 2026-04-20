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
