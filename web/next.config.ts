import path from 'path';
import { withSentryConfig } from '@sentry/nextjs';
import type { NextConfig } from "next";
import { resolveSentryBuildUploadPolicy } from './src/lib/sentry-build-policy';

const sentryBuildUploadPolicy = resolveSentryBuildUploadPolicy(
  process.env.SENTRY_DISABLE_UPLOAD,
  process.env.SENTRY_AUTH_TOKEN,
);

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
  authToken: sentryBuildUploadPolicy.authToken,
  telemetry: sentryBuildUploadPolicy.telemetry,
  useRunAfterProductionCompileHook: sentryBuildUploadPolicy.useRunAfterProductionCompileHook,
  release: sentryBuildUploadPolicy.release,
  silent: !process.env.CI,
  widenClientFileUpload: true,
  sourcemaps: sentryBuildUploadPolicy.sourcemaps,
});
