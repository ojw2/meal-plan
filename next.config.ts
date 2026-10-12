import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Cache Components is off: nearly every page is per-session and kept live
  // via SSE, so dynamic rendering is simpler than Suspense-wrapping every
  // session read.
  cacheComponents: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
