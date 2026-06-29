/**
 * Decodes a base64-encoded blob and triggers a browser file download.
 * Creates a temporary `<a>` element, clicks it, then removes it and revokes
 * the object URL to avoid memory leaks.
 */
export function triggerDownload(base64: string, filename: string, mimeType: string): void {
  const binaryStr = window.atob(base64);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }
  const blob = new Blob([bytes], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
