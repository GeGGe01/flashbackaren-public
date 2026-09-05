---
feature: flashback-verification
status: prototype
major: v1
fork: F0
---

# Flashback verification — agent contract

## Invariants

- Verification is optional.
- Bind verification to Flashback UID.
- The challenge is time-limited.
- The challenge must be unpredictable.
- Public proof-of-control is not itself a login secret.
- Do not require Flashback credentials.
- Do not store or automate a hidden authenticated Flashback session.
- Missing anchor deactivates verified state rather than deleting canonical Flashback identity.
- External failure information is intentionally minimal.

## State model

Distinguish:
- challenge pending;
- challenge expired;
- verified active;
- verified inactive because anchor is missing.

Do not encode these distinct internal states as misleading database names merely because
the UI uses one generic failure message.

## Acceptance checks

- A valid public signature challenge binds to the intended UID.
- An expired challenge cannot verify.
- A copied challenge cannot verify the wrong target UID.
- Removing the anchor makes verified capability inactive.
- Restoring or renewing the anchor can restore verified capability according to policy.
- External error text does not reveal which internal verification condition failed.

## Documentation update requirement

After implementing or materially changing this feature, update the relevant PoAG
documentation in this feature directory and all directly affected linked documents.

Update [PoAG.md](../../PoAG.md) when project-level state changes.

Update the operational decision log when an operational decision changes.

Do not consider implementation complete while relevant documentation is stale.
