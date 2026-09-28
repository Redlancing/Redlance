import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  transpilePackages: ["@redlance/db", "@redlance/core"],
};

export default nextConfig;
