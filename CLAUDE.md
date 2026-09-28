# CLAUDE.md

## Shipping changes

When a change is finished, create a pull request and merge it into `main` without asking first — the owner has pre-approved this. Merging to `main` deploys to production on Vercel, so before merging:
- make sure the Vercel preview deployment check on the PR has passed (if it failed, fix it rather than merging), and
- say in the PR description what was tested and what couldn't be.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
