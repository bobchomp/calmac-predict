import fs from "node:fs";
import path from "node:path";
import Script from "next/script";

export const dynamic = "force-static";

// Stage 1 of the Next.js move: the original page markup and script, unchanged.
// The script expects global functions for its inline onclick handlers, so it
// stays a classic script loaded after hydration rather than a bundled module.
const bodyHtml = fs.readFileSync(path.join(process.cwd(), "legacy/body.html"), "utf8");

export default function Home() {
  return (
    <>
      <div style={{ display: "contents" }} dangerouslySetInnerHTML={{ __html: bodyHtml }} />
      <Script src={`/legacy/app.js?v=${process.env.NEXT_PUBLIC_BUILD_ID}`} strategy="afterInteractive" />
    </>
  );
}
