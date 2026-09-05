---
title: Anonymous identity
status: prototype
major: v1
fork: F0
---

# Anonymous identity

## Why — 30 seconds

The prototype needs enough continuity to make trivial vote abuse inconvenient without
pretending it knows who a person is.

## How

```text
browser metadata
      ↓
local heuristic identity
      ↓
@anotheruser########
```

This identifies a browser-like client among visitors.

It does not claim to identify a person or Flashback account.

## Accepted error

Two different browsers may occasionally collapse into one local identity.

For this prototype that is accepted technical risk because the consequence is limited to
low-risk anti-abuse behavior.

## Hard boundary

IP address is not an identity signal.

## Session behavior

Anonymous continuity is the default.

No conventional logout flow is required.

The identity exists to support product behavior, not to create an account-management
system.
