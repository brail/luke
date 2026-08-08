/**
 * localStorage key that marks the daily greeting as already seen.
 *
 * Lives in a dependency-free module — no `'use client'`, no tRPC — so it can
 * be imported both by the hook and by the Playwright process, which needs to
 * suppress the modal before it intercepts clicks. Duplicating this format
 * elsewhere would mean that on the first change (prefix, timezone, version)
 * the suppression silently stops working, and every smoke test fails on a
 * click blocked by a full-screen `Dialog`.
 */
export function dailyGreetingSeenKey(date: Date = new Date()): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `luke-greeting-seen-${yyyy}-${mm}-${dd}`;
}
