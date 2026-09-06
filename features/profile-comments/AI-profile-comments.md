---
feature: profile-comments
status: prototype
major: v1
fork: F0
governs:
  - src/worker.ts
  - src/front.ts
  - migrations/0006_review_comment.sql
---

# Profile comments — agent contract

> **Built (2026-09-06):** a rater may attach an optional free-text review to their rating (either
> mode), stored as `ratings.comment` — one per (rater, target), replaced on re-rate. Both hard
> limits are enforced server-side (`cleanComment`: ≤420 chars AND ≤88 words → `comment_too_long`);
> the client shows a live char/word counter. The profile shows sampled reviews (text + the rater's
> stars); Q6 (sampling policy) is open — v1 samples by recency, top 5. This is our OWN stored user
> content: the point where BBS-lagen supervision applies (operator stance: remove directly-illegal;
> "den dagen, den sorgen"). Verified: store + sample (åäö intact), and both limits reject.

## Invariants

- Comments are optional.
- Enforce both 420-character and 88-word limits.
- Store comment with the rating event that produced it.
- Display the associated score with the sampled comment.
- Do not turn comments into a threaded discussion system in v1.

## Acceptance checks

- A comment over either limit is rejected or truncated according to explicit UI policy.
- The score displayed with a sampled comment belongs to the same rating event.
- Sampling never returns a comment for the wrong target user.
- Empty comments do not create meaningless records.

## Documentation update requirement

After implementing or materially changing this feature, update the relevant PoAG
documentation in this feature directory and all directly affected linked documents.

Update [PoAG.md](../../PoAG.md) when project-level state changes.

Update the operational decision log when an operational decision changes.

Do not consider implementation complete while relevant documentation is stale.
