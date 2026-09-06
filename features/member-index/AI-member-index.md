---
feature: member-index
status: prototype
major: v1
fork: F0
governs:
  - src/worker.ts
  - migrations/0002_seed_demo.sql
  - migrations/0004_member_facts.sql
---

# Member index — agent contract

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
> budget/queue later.

## Invariants

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
