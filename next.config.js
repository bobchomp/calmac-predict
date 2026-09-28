/** @type {import('next').NextConfig} */
module.exports = {
  // pdf-parse runs its self-test when bundled; ws/web-push have optional native deps
  serverExternalPackages: ["pdf-parse", "web-push", "ws"],
  async rewrites() {
    return {
      // Unknown paths serve the app, as the old vercel.json SPA rewrite did
      fallback: [{ source: "/:path*", destination: "/" }],
    };
  },
};
