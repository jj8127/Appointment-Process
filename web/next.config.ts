import path from 'path';
import { withSentryConfig } from '@sentry/nextjs';
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  transpilePackages: ['..', 'react-force-graph-2d', 'force-graph', 'd3-force'],
  experimental: {
    externalDir: true,
  },
  outputFileTracingExcludes: {
    '/api/agent-room': ['./next.config.ts'],
  },
  // Vercel project Root Directory is `web`, so keep Turbopack rooted here.
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT || 'garamin-web',
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  widenClientFileUpload: true,
});
