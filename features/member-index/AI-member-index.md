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

> **v1-core slice (built 2026-09-05):** local search over a seeded index only. The index is
> pre-seeded with synthetic demo members (`0002_seed_demo.sql`) — upstream lookup on miss and
> the real Q5 pre-seed (early members / moderators) are deferred, so the skeleton indexes no
> real person. UID is the primary key; username is stored verbatim.

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
