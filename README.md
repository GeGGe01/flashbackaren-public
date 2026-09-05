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

## Run the v1-core slice locally

The minimum coherent surface — find a member → rate them (0–5, half-star) → see the aggregate.
Runs fully local (Cloudflare Worker + D1 emulated by wrangler); no Cloudflare account needed.

```sh
npm install
npm run db:migrate:local   # creates the local D1 and seeds synthetic demo members
npm run dev                # wrangler dev on http://localhost:8787
```

Open http://localhost:8787, search `demo`, pick a member, drag the slider, and rate.

Note: v1 is intentionally trivial to game (no anti-abuse hardening) and rates only synthetic
demo members. See [PoAG.md](./PoAG.md) for the deliberate scope and what is deferred.
