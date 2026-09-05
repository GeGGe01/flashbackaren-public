---
feature: anonymous-identity
status: prototype
major: v1
fork: F0
governs:
  - src/worker.ts
---

# Anonymous identity — agent contract

> **v1-core slice (built 2026-09-05):** a browser cookie (`fb_meta`, random UUID) used ONLY as
> the rating's ownership key — one browser = one current rating per member. No fingerprint, no
> signal set, no sybil/velocity resistance: v1 is intentionally trivial to game. The full
> anti-abuse hardening (Q2 signal set etc.) is the deferred next layer.

## Invariants

- Do not use IP addresses as an identity signal.
- Do not claim heuristic client correlation is person identification.
- Anonymous use remains the default.
- Meta identity must be structurally distinct from Flashback account identity.
- Collisions are possible and must be treated as low-confidence correlation.

## Security boundary

Never expose the raw signal set when a derived identifier is sufficient.

Do not provide externally visible diagnostics that help an actor tune around the
anti-abuse heuristic.

## Acceptance checks

- A stable browser can recover the same local meta identity under intended conditions.
- IP changes do not change identity because IP is not part of the signal.
- Distinct Flashback verification state is not conflated with anonymous identity.
- Failure responses do not reveal the signal composition.

## Documentation update requirement

After implementing or materially changing this feature, update the relevant PoAG
documentation in this feature directory and all directly affected linked documents.

Update [PoAG.md](../../PoAG.md) when project-level state changes.

Update the operational decision log when an operational decision changes.

Do not consider implementation complete while relevant documentation is stale.
