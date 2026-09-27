/**
 * The real client IP of the request apps/web is serving, for forwarding to apps/api as
 * `X-Forwarded-For` on a server-to-server call (CLAUDE.md rule 13).
 *
 * NPM (Nginx Proxy Manager) sits in front of apps/web in every deployed environment and uses
 * `$proxy_add_x_forwarded_for`, which APPENDS its own resolved peer address rather than replacing
 * an existing header — so the real client IP is the LAST entry, not the first. Taking the first
 * entry would return whatever value an attacker chooses to send in their own `X-Forwarded-For`
 * header, defeating IP-based rate limiting (CRITICAL, audit 2026-08-07). `undefined` if absent
 * (e.g. local `pnpm dev` without a reverse proxy).
 *
 * @param headers - The incoming request's headers (`Request.headers` or Next's `headers()`).
 */
export function clientIpFrom(headers: { get(name: string): string | null }): string | undefined {
  return headers.get('x-forwarded-for')?.split(',').pop()?.trim() || undefined;
}

/**
 * The `X-Forwarded-For` header for a server-to-server fetch to apps/api, or nothing when the
 * incoming request carried no client IP. Without it every such call is keyed on the web
 * container's address, so one IP rate-limit bucket is shared by every user.
 */
export function forwardedFor(headers: { get(name: string): string | null }): Record<string, string> {
  const ip = clientIpFrom(headers);
  return ip ? { 'X-Forwarded-For': ip } : {};
}
