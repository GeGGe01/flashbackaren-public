---
feature: member-index
status: prototype
major: v1
fork: F0
governs:
  - src/worker.ts
  - migrations/0002_seed_demo.sql
---

# Member index — agent contract

> **Real cold-boot preseed (built 2026-09-06):** `POST /api/preseed/moderators` fetches
> Flashback's **public** moderators page, decodes it (ISO-8859-1), parses `/uNNN` + username, and
> upserts real members into the index (verified: 94 moderators, no mojibake, searchable). UID
> (the Flashback UID) is the primary key; username is stored verbatim; we store only these facts,
> never post content. Synthetic demo members remain for offline play.
>
> **Boundary finding (Q5):** the top-posters **memberlist** (`memberlist.php?do=getall…`) is
> **authenticated-only** (HTTP 401 "Du är inte inloggad"), so it is on the far side of the
> trust-domain boundary and is NOT fetched. Individual member **profiles** (`/uNNN`) ARE public,
> so specific named members (e.g. via a known handle/UID) can be added directly; the bulk
> top-posters ranking is unavailable without a session and stays out. Later this preseed becomes a
> background job (Queues/Cron); it is an explicit trigger for now.

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
