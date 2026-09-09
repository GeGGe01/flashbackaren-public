# Flashbackaren

An open **reputation prototype** that rates Flashback forum **users — not posts** — as a companion
layer over public forum activity. Built as a small, self-contained Cloudflare Worker.

> Status: early **prototype / work in progress**. Interfaces and the data model may still change.

## What it does

- **Member index.** Members are keyed by their stable Flashback UID; usernames are stored as-is.
- **Ratings.** Two modes:
  - **Direct** — 0–5 stars in half-star steps.
  - **Rich** — multiple weighted, typed criteria (`scale`, `boolean`, `ordinal`, `percentage`,
    `bipolar`). The server normalizes each value and computes a canonical score in **basis points**
    (`0..10000`, where `10000 = 5.00★`), so a weighted result can be finer than a half-star (e.g.
    `4.325★`). It also returns an evaluation trace ("show the calculation").
- **Template ecosystem.** A rating template is a **versioned work**: published versions are
  **immutable**, a *revision* adds a new version to the same work, and a *fork* creates a new work
  whose first version derives from an exact source version. Criterion identity is stable across
  relabels; templates are tiered **standard → featured → community**. Ratings bind to the exact
  template version used, so historical ratings stay reproducible.
- **Global reputation.** Community score `B = mean(current ratings)`, plus a small, separate activity
  bump: `R = min(5, B + 0.1·postsPerDay)`.
- **One encoding boundary.** All upstream bytes cross a single normalizer that yields canonical UTF-8
  (handles ISO-8859-1 pages and browser-saved UTF-8 with stale meta), so parsers never re-decode.

## Tech

Cloudflare Workers + D1 (SQLite), TypeScript, tested with [vitest](https://vitest.dev/).

## Run locally

```bash
npm ci
npm test              # unit tests
npm run typecheck     # tsc --noEmit
npx wrangler d1 migrations apply flashbackaren-v1 --local
npx wrangler dev      # miniflare emulates D1 — no Cloudflare account needed
```

## Deploy (your own Cloudflare account)

```bash
npx wrangler d1 create flashbackaren-v1        # then put the id in wrangler.toml
npx wrangler d1 migrations apply flashbackaren-v1 --remote
npx wrangler secret put ADMIN_SECRET           # gates the admin/import endpoints (fail-closed)
npx wrangler secret put META_SIGNING_SECRET    # signs the fb_meta identity cookie (ownership proof)
npx wrangler deploy
```

Optionally serve under a path prefix (`BASE_PATH`) or a route — see `wrangler.toml`.

## Data & good-neighbour crawling

The crawler sends an **honest, identifying User-Agent** so the forum can attribute its traffic and
reach a contact rather than blanket-blocking an anonymous scraper — set a real contact channel for
your deployment (`src/flashback.ts`). It stores only **facts** (UID, username, registration date,
post count) plus the reputation layer — never post content. Member-list imports are gated behind an
admin secret and happen from a logged-in human's own export; the app holds no forum session.

## License

To be decided.
