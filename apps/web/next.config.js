/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@luke/core', '@luke/api'],
  typedRoutes: true,
  env: {
    NEXT_PUBLIC_APP_VERSION: process.env.npm_package_version || 'dev',
  },
  experimental: {
    externalDir: true,
    proxyTimeout: 360_000, // 6 min — query portafoglio impiegano ~3–4 min, +2 min di margine
  },
  turbopack: {
    root: require('path').resolve(__dirname, '../..'),
  },
  webpack: config => {
    config.resolve.alias = {
      ...config.resolve.alias,
      '@': require('path').resolve(__dirname, 'src'),
    };
    return config;
  },

  /**
   * Production proxy rewrites (Option B — single hostname via NPM → Next.js → API).
   *
   * In production, all traffic arrives on the public hostname (e.g. luke.febos.local).
   * The browser can only reach Next.js, so tRPC calls and file uploads must be
   * forwarded to the API container via these rewrites.
   *
   * INTERNAL_API_URL is a server-only env var (set in docker-compose) pointing to the
   * API container on the internal Docker network (e.g. http://api:3001).
   * In development it is not set, so the rewrites are skipped entirely.
   *
   * Routes NOT proxied here (already handled by Next.js route handlers):
   *   /api/auth/...               → NextAuth
   *   /api/uploads/...            → app/api/uploads/[...path]/route.ts
   *   /api/upload/brand-logo/temp → app/api/upload/brand-logo/temp/route.ts
   *
   * An API path missing from this list does NOT fail loudly: it falls through to Next's own
   * routing, which answers with the 404 page. A `fetch` caller sees `res.ok === false`, but an
   * `<a download>` caller just saves that HTML under the requested filename — which is how
   * backup downloads shipped 24KB of 404 page instead of the backup. To keep that impossible,
   * every raw browser-facing API route lives under `/download/` (GET, streamed responses) or
   * `/upload/` (POST, streamed request bodies), both wildcarded below, and
   * `apps/api/test/rawRouteProxy.spec.ts` fails the build on a route registered outside them.
   */
  async rewrites() {
    const apiUrl = process.env.INTERNAL_API_URL;
    if (!apiUrl) return [];

    return [
      // tRPC batch/streaming
      { source: '/trpc/:path*',    destination: `${apiUrl}/trpc/:path*` },
      // Direct file uploads (brand logo by id, collection row pictures, backup import)
      { source: '/upload/:path*',  destination: `${apiUrl}/upload/:path*` },
      // Streamed downloads (backup blob/export, audit log CSV, season calendar exports)
      { source: '/download/:path*', destination: `${apiUrl}/download/:path*` },
      // SSE session invalidation
      { source: '/session-events', destination: `${apiUrl}/session-events` },
      // SSE notifications push
      { source: '/api/sse',        destination: `${apiUrl}/api/sse` },
      // Health check passthrough
      { source: '/health',         destination: `${apiUrl}/health` },
    ];
  },
};

module.exports = nextConfig;
