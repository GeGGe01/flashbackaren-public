---
title: Member index
status: prototype
major: v1
fork: F0
---

# Member index

## Why — 30 seconds

Searching Flashback for every interaction wastes upstream requests.

The prototype should remember the public member identity it has already seen.

## How

```text
user query
   ↓
local index
   ↓ miss
Flashback member lookup
   ↓
cache / persist UID + username
   ↓
future local search
```

Canonical member identity:

```text
Flashback UID
```

Example profile URL can always be derived from the UID.

## Stored minimum

At minimum:

```text
uid
username
```

Additional public profile facts should be added only when they support an actual feature.

## Pre-seed

Current intent:

```text
early members
all moderators
additional member-list sample
```

Idle/background work may progressively expand the local index while respecting upstream
request budgets.

## Legacy names

Very old Flashback usernames may contain characters that current registrations reject.

Never rewrite the canonical username into a modernized form.

Use a separate normalized search representation if fuzzy matching needs one.

## Batch data

Posts per day only needs approximate weekly refresh for the prototype.
