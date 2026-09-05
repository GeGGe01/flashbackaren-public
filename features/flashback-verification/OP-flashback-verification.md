---
title: Flashback verification
status: prototype
major: v1
fork: F0
---

# Flashback verification

## Why — 30 seconds

Some future features may need proof that a visitor controls a specific Flashback account.

Flashback does not provide the desired native programmatic login flow, so verification is
performed through a public proof-of-control challenge instead.

## How

```text
generate challenge
      ↓
user places linked challenge in Flashback signature
      ↓
parser checks public profile
      ↓
bind local verified state to Flashback UID
```

The signature anchor also links to the prototype's start page.

Verification is voluntary.

Anonymous use remains available.

## Persistence

Verification is not treated as permanent merely because it succeeded once.

The public anchor is checked again on later verified access.

If it disappears, verified state becomes inactive.

The user can restore the anchor or complete a fresh challenge.

## Failure UX

Expose one generic failure message where possible.

Internal state may remain precise without telling the actor which check failed.

## Identity boundary

Verification proves control of the public Flashback account anchor.

It does not prove legal identity.
