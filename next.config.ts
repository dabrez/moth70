import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  serverExternalPackages: ['@prisma/client'],
  // The e2e suite and the extension reach the dev server by IP rather than "localhost".
  allowedDevOrigins: ['127.0.0.1'],
};

export default nextConfig;
