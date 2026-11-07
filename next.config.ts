import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native/server-only packages must not be bundled by Turbopack/webpack.
  serverExternalPackages: ["firebase-admin", "@google-cloud/storage", "sharp"],
};

export default nextConfig;
