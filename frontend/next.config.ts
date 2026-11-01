import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  distDir: "dist",
  trailingSlash: false,
  allowedDevOrigins: ["localhost", "127.0.0.1"],
  images: { unoptimized: true },
};

export default nextConfig;
