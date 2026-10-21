# CLAUDE.md

## Shipping changes

There are two long-lived branches:
- `dev` deploys to **dev.willitsail.co.uk** (Vercel preview, behind Vercel login, its own Upstash database, never sends push alerts or emails).
- `main` deploys to production, **www.willitsail.co.uk**.

When a change is finished, create a pull request **into `main`** and merge it without asking first — the owner has pre-approved this. Merging to `main` deploys to production, so before merging:
- make sure both checks on the PR have passed — the Vercel preview deployment and **Tests** (`npm test`, required on `main`); if either failed, fix it rather than merging,
- add or update tests in `tests/` for what the change does, and
- say in the PR description what was tested and what couldn't be.

Use `dev` only when the owner asks for something to be tried there first: then the pull request goes into `dev` (merged without asking, same checks), and `dev` goes to `main` only when the owner says. After anything merges into `main`, bring `dev` up to date with it so the two don't drift apart.

How dev stays apart from production:
- Vercel preview deployments read `DEV_UPSTASH_REDIS_REST_URL`/`_TOKEN` only (`lib/kv.js`, `pages/api/notify.js`), and `/api/notify` refuses to send on them.
- The GitHub Actions workflows pick the database by branch: `main` gets production's secrets; any other branch gets the `DEV_` ones, `SITE=dev` and no `CRON_SECRET`. Alerts and Daily run from `main` only. The dev tracker is started by cron-job.org with `{"ref":"dev"}`.
- Never point dev at the production database. The `Copy production data to dev` workflow only reads production.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
