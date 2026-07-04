import path from 'path';
import { withSentryConfig } from '@sentry/nextjs';
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  transpilePackages: ['..', 'react-force-graph-2d', 'force-graph', 'd3-force'],
  experimental: {
    externalDir: true,
  },
  // Keep Turbopack at the repository root so web can consume shared root modules.
  turbopack: {
    root: path.resolve(__dirname, '..'),
  },
};

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT || 'garamin-web',
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  widenClientFileUpload: true,
});
