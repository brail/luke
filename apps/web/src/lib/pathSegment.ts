/** Word characters, dots and dashes, never `.` or `..`: nothing that leaves the proxied prefix. */
const SAFE_SEGMENT_RE = /^(?!\.{1,2}$)[\w.-]+$/;

/** Whether a URL path segment may be forwarded to apps/api by a proxying route handler. */
export function isSafePathSegment(segment: string): boolean {
  return SAFE_SEGMENT_RE.test(segment);
}
