# CalMac reliability reports → Redis

The monthly job (`.github/workflows/monthly.yml`) that keeps each route's historical reliability up to date. The site's sailing chances use it through the thresholds (`lib/reliability.js`, served by `/api/thresholds`).

Each run:

1. **Reads CalMac's published figures** (`calmac.mjs`):
   - **Island performance packs**, from [corporate.calmac.co.uk/…/island-performance](https://corporate.calmac.co.uk/en-gb/about-us/performance-reports/island-performance/). The job reads the newest month's packs every run. It reads an older month's packs only while that month is missing for most routes; in practice this happens on the first run, to fill in from late 2024.
     - Since August 2026, each pack has a table of 12 months of each of the island's routes (`parseRows`).
     - Before that, each pack has only its own month's sailings, leg by leg. Reliability is worked out from those counts as CalMac does: sailings operated, less additional ones, out of those scheduled (`parseLegRows`).
   - **Each route's own report page**, from [corporate.calmac.co.uk/…/route-performance-reports](https://corporate.calmac.co.uk/en-gb/about-us/route-performance-reports/). CalMac stopped updating these at October 2024, but they're the only source for Mallaig – Armadale, Mallaig – Small Isles and Oban – Lismore.
2. **Saves them to Redis `reliability`.** A month not saved yet is added. A month CalMac now gives a different figure for is replaced, since the newest source wins.
3. **Works the thresholds out again into Redis `thresholds`.**

Run with `MODE=dry` (the workflow's **dry** option), it saves nothing. Instead it reports:
- what would be added or replaced;
- each route's months, first to last;
- how each route's thresholds would move.

## Notes

- The PDFs are tables. CalMac's place every character separately, so `pageText` rebuilds the rows from where the characters sit on the page.
- `PACK_ROUTES` maps the packs' route names to the site's. A route CalMac renames, or a new route, needs adding there, and in `ROUTE_SLUGS` if it has a report page.
- The packs' other routes (Fionnphort – Iona, Berneray – Leverburgh, Ardmhor – Eriskay, Mallaig – Lochboisdale and others) aren't on the site, so they're skipped.
- Uig – Tarbert/Lochmaddy is a triangle route. Worked out from its legs, it comes within about half a point of the figure in CalMac's own table.

## Running it

```sh
npm ci --prefix scripts/jobs/reliability
MODE=dry UPSTASH_REDIS_REST_URL=… UPSTASH_REDIS_REST_TOKEN=… CRON_SECRET=… \
  node --import ./scripts/jobs/register.mjs scripts/jobs/reliability/index.mjs
```

It needs only `pdf-parse`, its own dependency, kept apart from the site's.
