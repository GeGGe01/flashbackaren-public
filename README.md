# Flashbackaren

Flashbackaren is a prototype-launch surface — a place where prototypes get published and
tried. Flashback is used as the medium that gives those prototypes meaning; it is not a
committed product direction. What this ultimately becomes is deliberately undecided.

The surface is intended to be served at typ.gegge.se/flashbackaren (or similar).

This repository is the current prototype: a reputation and identity experiment around
Flashback's public member universe.

Read [PoAG.md](./PoAG.md) for the project TL;DR.

Agents must read [AGENTS.md](./AGENTS.md) before implementation.

Feature documentation lives under [features/](./features/).

## Run V1 locally

The reputation prototype — find a member → rate them (direct 0–5 half-star, or rich multi-criteria)
→ see reputation `R = min(5, B + 0.1·P)` with the breakdown, plus optional free-text reviews. Runs
fully local (Cloudflare Worker + D1 emulated by wrangler); no Cloudflare account needed.

```sh
npm install
npm run db:migrate:local   # creates the local D1 and seeds a few synthetic demo members
npm run dev                # wrangler dev on http://localhost:8787
```

Real members are indexed via `POST /api/preseed/moderators` (public moderators page) and
`POST /api/preseed/memberlist` (operator-exported memberlist HTML); any exact username also resolves
on demand via Flashback's public member search. All ingestion is facts-only (UID, username, reg date,
post count) through the FlashbackNormalizer — no content stored. Search a real handle (e.g. `The Crash`)
and rate them.

Note: V1 is **intentionally trivial to game** (no anti-abuse hardening yet) — the point of the first
surface is to feel the reputation model with honest users. See [PoAG.md](./PoAG.md) and
[docs-review/REVIEW-2026-09-06.md](./docs-review/REVIEW-2026-09-06.md) for scope, the reconciled
open-question ledger, and the next-phase plan.
