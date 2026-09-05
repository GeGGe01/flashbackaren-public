---
feature: reputation
status: prototype
major: v1
fork: F0
governs:
  - src/worker.ts
  - migrations/0001_init.sql
---

# Reputation — agent contract

> **v1-core slice (built 2026-09-05):** direct 0–5 half-star rating only, stored as
> `score_halfsteps` 0–10; aggregate is the plain mean. Weighted criteria, templates, and the
> activity component (`R = min(5, B + 0.1P)`) are deferred — the slice implements `B` only, so
> Q1 stays open. The Worker implements this alongside member-index and anonymous-identity, so
> `governs` overlaps on `src/worker.ts`.

## Invariants

- Canonical visible scale is 0–5.
- Half-star ratings are supported.
- Direct final rating and criteria-based rating are both supported.
- Criteria not selected by the rater do not need to contribute.
- Activity and quality are separate components.
- Final visible score must not exceed 5.
- Do not silently reinterpret activity as evidence of quality.

## Data model expectations

Support:
- one rating event per rater/target relationship according to anti-abuse policy;
- direct score;
- criteria scores;
- criteria weights;
- derived final score;
- provenance to template/version when a template is used.

## Acceptance checks

- Direct rating works without criteria.
- Criteria-based rating produces deterministic output.
- Half-star precision round-trips correctly.
- Missing irrelevant criteria do not become zeroes.
- Activity component is independently inspectable.
- Final score never exceeds 5.

## Documentation update requirement

After implementing or materially changing this feature, update the relevant PoAG
documentation in this feature directory and all directly affected linked documents.

Update [PoAG.md](../../PoAG.md) when project-level state changes.

Update the operational decision log when an operational decision changes.

Do not consider implementation complete while relevant documentation is stale.
