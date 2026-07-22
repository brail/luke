/**
 * Triggers a browser file download for an in-memory `Blob`.
 * Creates a temporary `<a>` element, clicks it, then removes it and revokes
 * the object URL to avoid memory leaks.
 */
export function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Triggers a native browser download for a plain URL (e.g. a signed download link) —
 * no `fetch`/`Blob` involved, so the file never gets buffered into page memory first.
 */
export function triggerUrlDownload(url: string, filename: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

/** Decodes a base64-encoded blob and triggers a browser file download. */
export function triggerDownload(base64: string, filename: string, mimeType: string): void {
  const binaryStr = window.atob(base64);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }
  triggerBlobDownload(new Blob([bytes], { type: mimeType }), filename);
}
