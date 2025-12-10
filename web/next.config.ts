import path from 'path';
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  transpilePackages: ['..'],
  experimental: {
    externalDir: true,
  },
  // Force Turbopack to treat the web folder as the workspace root (prevents appDir 404)
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
