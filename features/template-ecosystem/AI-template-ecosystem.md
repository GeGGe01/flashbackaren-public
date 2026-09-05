---
feature: template-ecosystem
status: prototype
major: v1
fork: F0
---

# Template ecosystem — agent contract

## Invariants

- Standard templates rank above featured templates.
- Featured templates rank above ordinary community templates.
- Community templates remain discoverable.
- Maximum active criteria in v1 is 10.
- Template forks preserve parent/version relationships.
- Template identity must not depend only on mutable display labels.

## Required capabilities

Support:
- create;
- configure;
- publish;
- fork;
- version;
- compare to parent;
- canonicalize;
- deduplicate where equivalent.

## Acceptance checks

- A fork points to its parent.
- Standard/featured/community ordering is deterministic.
- A template cannot exceed the v1 active-criteria limit.
- Criterion identity can survive a label rename.
- Duplicate or near-identical submissions do not require unbounded storage growth.

## Documentation update requirement

After implementing or materially changing this feature, update the relevant PoAG
documentation in this feature directory and all directly affected linked documents.

Update [PoAG.md](../../PoAG.md) when project-level state changes.

Update the operational decision log when an operational decision changes.

Do not consider implementation complete while relevant documentation is stale.
