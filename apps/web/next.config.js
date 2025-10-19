/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@luke/core', '@luke/api'],
  typedRoutes: true,
  experimental: {
    externalDir: true,
  },
  webpack: config => {
    config.resolve.alias = {
      ...config.resolve.alias,
      '@': require('path').resolve(__dirname, 'src'),
    };
    return config;
  },
};

module.exports = nextConfig;
