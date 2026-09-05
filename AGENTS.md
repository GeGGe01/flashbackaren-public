# Agent entry point

Read [PoAG.md](./PoAG.md) first.

This repository is prototype-first.

For implementation, read the AI contract for every affected feature.

## Feature contracts

- [Reputation](./features/reputation/AI-reputation.md)
- [Template ecosystem](./features/template-ecosystem/AI-template-ecosystem.md)
- [Member index](./features/member-index/AI-member-index.md)
- [Anonymous identity](./features/anonymous-identity/AI-anonymous-identity.md)
- [Flashback verification](./features/flashback-verification/AI-flashback-verification.md)
- [Profile comments](./features/profile-comments/AI-profile-comments.md)

## Project-wide invariants

- Flashback UID is canonical member identity.
- Username is presentation, not identity.
- IP addresses are not identity signals.
- Browser fingerprinting is heuristic differentiation, not proof of personhood.
- Anonymous use is the default.
- Verification is optional.
- Do not use an authenticated Flashback session as a hidden dependency unless the operator
  explicitly changes the design.
- Minimize upstream load through local caching/indexing.
- D1 is preferred for relational source-of-truth state; KV is preferred only where cache
  semantics are acceptable.
- External errors should not reveal unnecessary internal state.
- Keep implementation and documentation synchronized.

## Documentation completion rule

After implementing or materially changing a feature:

1. update the affected AI and OP documents;
2. update [PoAG.md](./PoAG.md) if project state, roadmap, fork ownership, constraints, or
   open questions changed;
3. update the operational decision log if an operational decision changed;
4. never silently resolve an operator-owned open question.

Implementation is incomplete while relevant documentation is stale.

## Reference hygiene

A single-backtick inline span is a semantic reference and must resolve as an artifact or
path.

Commands, snippets, configuration, and illustrative technical text belong in fenced code
blocks when they are not live references.
