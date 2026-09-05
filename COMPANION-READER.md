# Companion Reader — the north star

Flashbackaren starts as a standalone reputation layer for Flashback's users, but is meant
long-term to grow into a **companion reader**: an alternative reading surface over Flashback's
public content, where Flashbackaren's own metadata — reputation, ranking, discovery, and social
features — integrates directly into the reading experience.

This document is the durable capture of that vision (authored with Dexter/ChatGPT; direktor's
review notes are in the final section). `PoAG.md` links here rather than inlining it.

## The load-bearing boundary

> Public Flashback data may be fetched, indexed, and rendered by us. Anything that requires an
> **authenticated** Flashback session stays with real Flashback.

Flashbackaren must never need to act as an authenticated Flashback client or handle users'
Flashback sessions. As a matter of principle we do **not**:

- accept Flashback passwords,
- store users' Flashback cookies,
- reverse-proxy authenticated sessions,
- use a shared Flashback account as a backend,
- synthesize private information we cannot actually observe.

The decision rule for every feature:

> Can Flashbackaren derive it from public Flashback data? **Render it.**
> Does the operation or data require an authenticated Flashback session? **Link to the original.**

This keeps Flashback and Flashbackaren in separate trust domains.

## 1. Form factor

Not finally decided. The long-term product should be its **own web-based reader**, not a mere
sidebar or lookup widget. Current technical direction:

- React + TypeScript; Cloudflare as host target; responsive web as the base.
- No native mobile app planned. PWA is possible later but not a V1 requirement.
- Desktop and mobile use the same application.

The Companion Reader should become a destination in itself: the user searches, opens a thread,
and keeps reading inside Flashbackaren. A sidebar / browser extension may later be a complement,
but should not be the canonical product — it would couple Flashbackaren's functionality to
Flashback's DOM and frontend.

## 2. Relation to Flashback

The Companion Reader is its own reader that renders public Flashback content:

```text
Flashback → public data → Flashbackaren parser/index → our representation + our reputation layer
```

A publicly reachable thread can therefore be rendered natively by us with Flashbackaren's
information layered on top, e.g.:

```text
The Crash   ★★★★½ 4.6   [Rate] [Reputation]
<public Flashback post>
```

Thread-level properties can later include: readability, community ranking, recommendations,
participants' reputation, our own bookmarks/follows, related threads.

Flashbackaren may visually feel like a logged-in forum page, but the user is identified with
**Flashbackaren, not Flashback**. Operations that require a real Flashback session become
**bridge-outs** — Reply ↗, Send PM ↗, Report ↗, Control panel ↗ — which open the right
destination on flashback.org in a new tab, where the user's real session handles it.

## 3. Data flow

Cloudflare-first with minimal external dependencies. Planned stack:

```text
React/Vite → TypeScript Worker API → Flashback fetch/parser → { D1 (SoT) | KV (cache) }
                                                                     ↑ Cloudflare Queues
                                                                     ↑ Cron / interactive jobs
```

- **D1** is the persistent relational source of truth. **KV** is cache, never authoritative for
  relational state.
- **Cloudflare Queues** carry upstream work in two classes: **interactive** (a real visitor is
  waiting) and **background** (cache expansion, member indexing, periodic profile snapshots,
  future thread indexing).
- Upstream toward Flashback uses a global safety ceiling, a separate budget per endpoint/cost
  class, conservative static drift, adaptive backoff downward, and **no** automatic chase for
  maximum throughput.
- Cache discipline: local/cache hit → use local; miss → fetch public from Flashback → parse →
  persist/cache → return. Background work makes the system progressively less dependent on
  on-demand calls.

The Companion Reader does **not** require a separate gateway as an architectural constraint. If
an MCP/git-like gateway is later added to the infrastructure it can feed the same domain model,
but the reader should not depend on that transport.

From the start, external objects carry a canonical source identity:

```text
source      = flashback
source_type = member | thread | post | forum
source_id   = upstream id
source_url  = canonical Flashback URL
```

V1 only needs to implement `member`; the model leaves a seam for the other types.

## 4. Reputation: core, not the whole

Reputation is the origin and the core of the V1 product — but the long-term reader is larger:
member discovery, thread reader, thread discovery, recommendations, templates/ratings,
follows/bookmarks, social features. Reputation becomes one of the most important *data layers*
in a larger reader, not the whole end product.

This is one reason reputation judges the **user over time** rather than individual posts: when
the same user then appears in a thread, their reputation follows through the whole reading
experience — enabling discovery Flashback itself does not offer ("Flashbackaren recommends"),
weighting community assessments, participants' reputation, thread quality/readability, sustained
activity relative to age, and future signals. The general rating engine can later apply to other
Flashback entities, but V1 is not generalized prematurely for that alone.

## 5. Horizons

- **V1 — Reputation.** The standalone core: Flashback member register, local member search/cache,
  D1 + KV, 0–5 reputation, activity component, rich criteria, custom weights, rating templates,
  free-text reviews (≤420 chars / ≤88 words), ≤10 criteria, meta-users, browser credential,
  fingerprint-based good-enough anti-abuse, no real login/logout, no Flashback account link.
  Rates Flashback **members**, not threads/posts.
- **V2 — Template ecosystem.** Forks, immutable published versions, template lineage, canonical
  hashes/dedup, Standard / Featured / Community tiers, uses/forks stats, criterion lineage.
  Standard and Featured sit above the community flow so junk templates don't wreck discovery.
- **V3 — Verification / identity linking.** Optional proof-of-control against Flashback:
  signature challenge → Flashback UID → verified identity. The public backlink must remain in the
  user's Flashback signature for verified status to stay active (so verification doubles as
  durable distribution). Anonymous use stays default. Some future features may gate to verified
  users or users meeting Flashback criteria (e.g. laidback status).
- **V4 — Companion Reader.** Flashbackaren begins rendering Flashback's public content as its own
  reading experience: threads, posts, forums, inline member reputation, own navigation,
  follows/bookmarks, thread discovery, "Flashbackaren recommends", richer social interaction among
  Flashbackaren's own users. Private/gated Flashback operations remain bridge-outs.
- **V5 — Deeper integration.** Investigate whether further integration adds enough value. May
  mean own infrastructure to recreate features Flashback only offers to authenticated users — so
  long as they can be derived **without** carrying a user's authenticated Flashback session.
  Actually using a Flashback session to interact with the forum is treated for now as a separate,
  much riskier architectural direction, not a natural continuation of the Companion Reader.

## Architecture principle

The most important long-term separation:

```text
Flashback     = upstream content / source
Flashbackaren = identity + reputation + curation + interaction + presentation
```

Flashbackaren can grow ever richer without its internal identity model or user session becoming
dependent on Flashback's authentication. That is why V1's anonymous `@user` is not a temporary
workaround — it is the **embryo of Flashbackaren's own user identity**, which can later own
ratings, templates, follows, recommendations, and social relations, whether or not it is ever
verified against a Flashback account.

## Open questions (companion track)

1. **Form factor** — web is the base; PWA, desktop layout, and a possible extension/sidebar are
   open. Rec: responsive React web first; PWA only when a concrete need appears.
2. **Canonical source reference** — introduce the small `source_*` abstraction already in V1.
3. **Companion Reader IA** — how forum list → thread → post → profile → reputation is actually
   navigated. Parked to V4.
4. **Thread discovery/ranking** — which signals define "worth reading". Parked to V4.
5. **Social interaction** — follows, bookmarks, recommendations, relations between our meta-users.
   Parked to V4.
6. **Deep Flashback integration** — the exact boundary of which gated features we might recreate
   ourselves. Parked to V5.
7. **Authenticated Flashback session** — whether we ever cross that line at all. Rec: no, until a
   future use case is strong enough to justify a separate security design.

## Open considerations — direktor review

These are review notes on the vision above, kept distinct from Dexter's authored capture.

- **Content re-hosting is a different axis than authentication.** The trust-domain boundary is
  airtight on auth/privacy, but V4 re-presents users' *posts* (copyrighted content) under our
  surface. That is a copyright / database-right / ToS question the auth boundary does not cover,
  and it concentrates at **V4, not V5**. It needs an explicit position (transformative/excerpt vs
  full render; attribution + canonical link back to the original).
- **Scraping fragility + Flashback's own anti-bot posture.** The reader depends on parsing
  vBulletin HTML (brittle) fetched from Cloudflare Workers. Flashback is served directly by nginx
  (verified: `server: nginx`, no Cloudflare) — so it is NOT the CF-behind-CF case that git.gegge.me
  is; but an nginx origin can still rate-limit or block by IP/UA, and vBulletin markup drifts.
  Needs a position on what happens when Flashback rate-limits/blocks (Workers egress from shared
  Cloudflare IPs), and how the parser survives markup changes.
- **The harassment surface scales at V4.** A per-user community score shown *inline on every post*
  is a far stronger pile-on / reputation-attack vector than an opt-in rating page. The
  "remove-illegal-only" moderation stance that fits V1 deserves a re-look before V4 (opt-out,
  no-pile-on mechanics, defamation exposure of inline scores on identifiable pseudonyms).
- **V1 (full) is not v1-core (the shipped slice).** This document's V1 is the full capability
  cluster; the shipped see-and-feel slice is v1-core — the smallest find → rate → see loop. They
  are consistent (the slice is the seed), but "V1" must not silently balloon the slice.
- **UX honesty.** "Feels like a logged-in forum page" while the user is identified with us, not
  Flashback, risks users believing actions affect their Flashback account. The bridge-out pattern
  helps; the not-Flashback signaling needs deliberate care.
