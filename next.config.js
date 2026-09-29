/** @type {import('next').NextConfig} */
module.exports = {
  // pdf-parse runs its self-test when bundled; ws/web-push have optional native deps
  serverExternalPackages: ["pdf-parse", "web-push", "ws"],
  async rewrites() {
    return {
      // Unknown page paths serve the app, as the old vercel.json SPA rewrite
      // did. Files (anything with an extension) and Vercel's /_vercel/ routes
      // are left to 404: a missing script served as the page breaks with
      // "Unexpected token '<'", as the Analytics script did.
      fallback: [{ source: "/:path((?!_vercel/)[^.]*)", destination: "/" }],
    };
  },
};
