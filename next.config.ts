import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Cache Components is off: nearly every page is per-session and kept live
  // via SSE, so dynamic rendering is simpler than Suspense-wrapping every
  // session read.
  cacheComponents: false,
  async headers() {
    return [
      {
        // Browsers must always fetch the latest service worker (PWA guide).
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
        ],
      },
    ];
  },
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
