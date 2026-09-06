---
feature: member-index
status: prototype
major: v1
fork: F0
governs:
  - src/worker.ts
  - src/flashback.ts
  - migrations/0002_seed_demo.sql
  - migrations/0004_member_facts.sql
  - migrations/0005_member_source.sql
---

# Member index — agent contract

> **Encoding boundary (2026-09-06):** ALL Flashback bytes cross exactly one boundary — the
> **FlashbackNormalizer** (`src/flashback.ts`) — which detects the encoding *per response*
> (HTTP charset → BOM → UTF-8 validity sniff → `<meta>` → ISO-8859-1 fallback) and yields canonical
> UTF-8 + source metadata (encoding, source URL). Everything downstream (parsers, API, storage)
> assumes UTF-8 and never decodes bytes itself. This fixes the class of bug behind the earlier
> mojibake/"posts not public" mistakes. The sniff is what makes live latin1 pages AND browser-saved
> UTF-8 pages (that still carry a stale ISO-8859-1 `<meta>`) both decode correctly — verified live
> (moderators=iso-8859-1, memberlist=utf-8, mojibake=0) and by fixtures in `src/flashback.test.ts`.
> Members carry a `source_url` (canonical profile URL) for debuggability. The adapter is meant to be
> reused later by thread search, batch jobs, and companion features.
>
> **Honest User-Agent (operator decision, 2026-09-06):** every normalizer fetch sends an
> identifying UA with a native contact channel so Flashback can attribute our traffic and reach the
> operator directly if anything pushes too hard — rather than blanket-blocking an anonymous scraper.
> Contact = a Flashback PM link to the operator's account (The Crash, u135422). Good-neighbour
> transparency, consistent with the conservative upstream budget; the future crawler inherits it.

> **Real cold-boot preseed (built 2026-09-06):** `POST /api/preseed/moderators` fetches
> Flashback's **public** moderators page, decodes it (ISO-8859-1), parses `/uNNN` + username, and
> upserts real members into the index (verified: 94 moderators, no mojibake, searchable). UID
> (the Flashback UID) is the primary key; username is stored verbatim; we store only these facts,
> never post content. Synthetic demo members remain for offline play.
>
> **Boundary finding (Q5):** the top-posters **memberlist** (`memberlist.php?do=getall…`) is
> **authenticated-only** (HTTP 401 "Du är inte inloggad"), so *we* never fetch it — we hold no
> Flashback session. Individual member **profiles** (`/uNNN`) are public.
>
> **Human-in-the-loop import (built 2026-09-06):** the authenticated fetch happens on the
> operator's side — they export the memberlist pages while logged in and POST the saved HTML to
> `POST /api/preseed/memberlist`, which parses **facts only** (UID, username, reg date, post count)
> out of each `media media-user` block and drops everything else (avatars etc.). This keeps the
> trust boundary intact (the session is the human's, never ours) and keeps the real-member corpus
> in D1, not in git. Verified: 5 pages → 500 top-posters (incl. **The Crash**, uid 135422, 12 251
> posts) + 94 moderators = 565 members, post counts + reg dates stored, no mojibake. Post count +
> account age feed the activity component (Q1) later.
>
> **Search-on-miss (built 2026-09-06):** `GET /api/members` is cache-first — it searches the local
> index, and only on a genuine miss (no local match, plausible username) resolves ONE exact name
> upstream via Flashback's PUBLIC member search `sok/?query=p:<name>`, which 302-redirects to the
> profile `/uNNN` on an exact match. We read the redirect (don't follow), take the canonical
> username from the public profile `<title>` (ISO-8859-1 decoded), cache the fact, and return it.
> This realises the "miss → lookup → cache" path entirely within the public/trust-domain boundary
> (no session). Verified: "Webbvavaren" (not preseeded) resolved to uid 1792136 and cached. The
> upstream call currently rides the interactive request; it should move behind the request
> budget/queue later. On-miss also captures the public **reg date** (`Reg: <strong>…</strong>`,
> in the static HTML) and last-activity. The **post count IS public but JS-rendered** on the
> profile — it is NOT in the static HTML our server fetch receives (verified on u1/u135422), so it
> is not captured server-side on-miss. The reliable static source for post counts is the gated
> **memberlist** (operator export); a JS-capable fetch or the underlying data endpoint would be
> needed to get posts for arbitrary on-miss members (not pursued now).
>
> **Resilience risk (2026-09-06):** the `p:` resolver is public (verified in incognito) but
> Flashback now knows about it (the entry was found by trial-and-error and posted in a thread), so
> it may be closed in future. Hedge: keep caching every resolved member (organic use already does),
> and — if broader coverage is wanted before any closure — a **paced** background crawl of PUBLIC
> **thread** pages (each post author is a `/uNNN` link, independent of `p:`) is the robust
> index-building source. Keep it paced: an aggressive burst could invite a faster shutdown. Post
> counts are public but JS-rendered (see above), so server-side they come from the memberlist
> export or a future JS-capable/endpoint fetch — the `p:` closure does not affect that.

## Invariants

- **Preseed/import endpoints (`/api/preseed/*`) require a server-side admin secret** (`ADMIN_SECRET`,
  fail-closed) — never publicly writable, or the memberlist import could inject fabricated facts.
- **Username is opaque upstream data** — no allowlist/regex; only bound length + reject control chars,
  URL-encode when querying. (Legacy names break any allowlist.)
- `resolveMemberUpstream` distinguishes NOT_FOUND from ERROR internally (an error is never cached as
  a miss); the external response stays minimal.
- Flashback UID is canonical member identity.
- Username is presentation/search data.
- Store upstream username exactly as returned.
- Do not canonicalize identity through normalized username.
- Minimize upstream calls through local lookup/cache.
- Respect endpoint-specific request budgets.

## Search

Maintain a normalized representation only for heuristic search.

Name collisions must resolve through UID, never normalized username.

## Acceptance checks

- Cached members can be searched without an upstream request.
- A miss can populate the local index.
- Legacy usernames round-trip unchanged.
- Two usernames that normalize identically remain distinct when UIDs differ.
- Weekly activity refresh does not require per-request upstream fetching.

## Documentation update requirement

After implementing or materially changing this feature, update the relevant PoAG
documentation in this feature directory and all directly affected linked documents.

Update [PoAG.md](../../PoAG.md) when project-level state changes.

Update the operational decision log when an operational decision changes.

Do not consider implementation complete while relevant documentation is stale.
