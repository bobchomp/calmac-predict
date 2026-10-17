/** @type {import('next').NextConfig} */
module.exports = {
  // ws/web-push have optional native deps
  serverExternalPackages: ["web-push", "ws"],
  async rewrites() {
    return {
      // Unknown page paths serve the app, as the old vercel.json SPA rewrite
      // did. Files (anything with an extension), Vercel's /_vercel/ routes and
      // /api/ are left to 404: a missing script served as the page breaks with
      // "Unexpected token '<'", as the Analytics script did, and a retired API
      // should say it's gone rather than answer with the page.
      fallback: [{ source: "/:path((?!_vercel/|api/)[^.]*)", destination: "/" }],
    };
  },
};
