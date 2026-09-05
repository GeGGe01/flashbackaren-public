# Flashbackaren

## TL;DR

Flashbackaren is a prototype that evaluates Flashback users over time instead of rating
single posts.

The core experiment is a configurable reputation system where a user can be rated directly
or through weighted criteria, with reusable templates, optional free-text comments, and a
small activity component derived from Flashback's public profile data.

Anonymous use is the default. A local browser-derived meta identity is used only as a
low-risk anti-abuse primitive. Optional verification against a Flashback account uses a
public signature challenge rather than Flashback login.

Flashback remains source of truth for public member identity. The prototype maintains a
local member index/cache to reduce upstream load.

Host target is Cloudflare. Minimize external dependencies.

## Purpose

Test whether a richer user-level reputation model produces more useful signal than a simple
post-level +1 system.

## Goals

- Rate users, not individual posts.
- Support direct rating or weighted multi-criteria rating.
- Allow half-star precision on a 0–5 scale.
- Let users create and fork rating templates.
- Keep standard and featured templates discoverable above community noise.
- Preserve anonymous use as the default.
- Support optional proof-of-control verification without Flashback login.
- Cache public member metadata locally to reduce repeated upstream requests.
- Keep the prototype small, inspectable, and easy to split into independent experiments.

## Principles

- Prototype first.
- User identity and content quality are separate concerns.
- Activity can influence reputation without being treated as quality.
- Flashback UID is canonical member identity.
- Username is presentation, not identity.
- Public upstream data should be cached rather than repeatedly fetched.
- IP addresses are not an identity signal.
- Heuristic browser differentiation is not proof of personhood.
- Security boundaries should expose no more information than required.
- Anonymous use remains possible even if verified-only features appear later.
- Features should remain detachable and document their own identity before integration.

## Current state

The rating model, template ecosystem, anonymous identity model, verification concept,
member indexing strategy, and comment limits are designed at prototype level.

No final implementation is assumed by this document.

## Roadmap

### v1 — coherent reputation prototype

- User search backed by local member index/cache.
- 0–5 rating with half-star precision.
- Direct or criteria-based rating.
- Configurable criteria and weights.
- Template creation/forking/discovery.
- Activity component based on posts per day.
- Anonymous browser-derived meta identity.
- Optional signature challenge verification.
- Free-text comments with hard limits.
- Profile presentation of reputation and sampled comments.

### v2 — stronger ecosystem behavior

Candidate horizon:

- richer template genealogy and comparisons;
- stronger discovery/ranking of templates;
- better user/profile visualizations;
- more explicit verified-member capabilities;
- stronger anti-abuse controls where real usage justifies them.

### v3+ — product expansion

Candidate horizon only:

- companion-reader surfaces;
- richer Flashback integration;
- additional public-data indexing;
- independent search/index capabilities.

## Active experiments

- Determine how much browser metadata is needed for "good enough" local anti-abuse without
  turning heuristic correlation into identity claims.
- Determine the smallest useful template calculus before adding more primitives.
- Determine which public member fields are worth persisting versus caching transiently.

## Active forks

- F0 — core product design.
- Search/index and companion-reader workstreams may live in their own conversation forks.

## Important constraints

- Cloudflare host target.
- Minimize external dependencies.
- TypeScript/Worker + React/Vite is the current preferred direction, not an immutable
  requirement.
- D1 is the preferred relational source of truth; KV is for cache semantics.
- Flashback public UID is canonical member identity.
- Do not normalize legacy usernames into canonical identity.
- Do not use IP address as an identity signal.
- Free-text comment limit: maximum 420 characters and maximum 88 words.
- Maximum 10 simultaneously active criteria per rating template in the initial prototype.
- Verification is optional.
- No user-facing logout flow is required for the local meta identity.
- Externally visible login/verification failure information should remain minimal.

## Open questions

### Q1 — Final rating aggregation formula

Planned major: v1  
Assigned fork: F0

The activity component is currently modeled as:

```text
R = min(5, B + 0.1P)
```

where B is the aggregated user rating and P is average posts per day.

Recommendation: keep the activity component small and independently inspectable.

### Q2 — Fingerprint signal set

Planned major: v1  
Assigned fork: F0

Determine the minimum browser-derived signal set that gives adequate anti-abuse
differentiation.

Constraint: no IP-based signal.

### Q3 — Verification challenge TTL and reactivation flow

Planned major: v1  
Assigned fork: F0

Define challenge lifetime and exact reactivation behavior when the signature anchor
disappears and later returns.

### Q4 — Exact legacy username compatibility rules

Planned major: v1  
Assigned fork: F0

Flashback contains old usernames that violate current registration rules. Do not derive
canonical identity from a normalized username.

### Q5 — Initial member pre-seed list

Planned major: v1  
Assigned fork: F0

Current intent: early members, all moderators, and an additional sample from the member
list.

### Q6 — Comment sampling rules

Planned major: v1  
Assigned fork: F0

Define how sampled profile comments are selected and whether sampling should be uniform,
weighted, or filtered by recency/quality.

### Q7 — Template calculus primitives

Planned major: v1  
Assigned fork: F0

Decide which native calculations and visual presentations deserve first-class support
before custom formulas are allowed to expand.

## Design cluster

- [Reputation model](./features/reputation/OP-reputation.md)
- [Template ecosystem](./features/template-ecosystem/OP-template-ecosystem.md)
- [Member index](./features/member-index/OP-member-index.md)
- [Anonymous identity](./features/anonymous-identity/OP-anonymous-identity.md)
- [Flashback verification](./features/flashback-verification/OP-flashback-verification.md)
- [Profile comments](./features/profile-comments/OP-profile-comments.md)
