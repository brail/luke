/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@luke/core', '@luke/api'],
  typedRoutes: true,
  experimental: {
    externalDir: true,
  },
};

module.exports = nextConfig;
