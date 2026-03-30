/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@luke/core', '@luke/api'],
  typedRoutes: true,
  experimental: {
    externalDir: true,
    proxyTimeout: 360_000, // 6 min — query portafoglio impiegano ~3–4 min, +2 min di margine
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
   */
  async rewrites() {
    const apiUrl = process.env.INTERNAL_API_URL;
    if (!apiUrl) return [];

    return [
      // tRPC batch/streaming
      { source: '/trpc/:path*',    destination: `${apiUrl}/trpc/:path*` },
      // Direct file uploads (brand logo by id, collection row pictures)
      { source: '/upload/:path*',  destination: `${apiUrl}/upload/:path*` },
      // SSE session invalidation
      { source: '/session-events', destination: `${apiUrl}/session-events` },
      // Health check passthrough
      { source: '/health',         destination: `${apiUrl}/health` },
    ];
  },
};

module.exports = nextConfig;
