export async function fetchImageAsBuffer(url: string, timeoutMs = 5000): Promise<Buffer | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
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
