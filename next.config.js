const BUILD_ID = process.env.VERCEL_GIT_COMMIT_SHA || String(Date.now());

/** @type {import('next').NextConfig} */
module.exports = {
  // Cache-busts public/legacy/app.js, which the service worker serves cache-first
  env: { NEXT_PUBLIC_BUILD_ID: BUILD_ID },
  // pdf-parse runs its self-test when bundled; ws/web-push have optional native deps
  serverExternalPackages: ["pdf-parse", "web-push", "ws"],
  async rewrites() {
    return {
      // Unknown paths serve the app, as the old vercel.json SPA rewrite did
      fallback: [{ source: "/:path*", destination: "/" }],
    };
  },
};
