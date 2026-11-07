import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server for the Cloud Run image. Only in the Docker build (NEXT_STANDALONE=1):
  // on Windows the standalone copy step needs symlink rights that pnpm layouts usually lack.
  output: process.env.NEXT_STANDALONE === "1" ? "standalone" : undefined,
  // Native/server-only packages must not be bundled by Turbopack/webpack.
  serverExternalPackages: ["firebase-admin", "@google-cloud/storage", "sharp"],
};

export default nextConfig;
