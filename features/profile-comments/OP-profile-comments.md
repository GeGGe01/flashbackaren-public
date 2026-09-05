---
title: Profile comments
status: prototype
major: v1
fork: F0
---

# Profile comments

## Why — 30 seconds

A number says what someone scored.

A short comment can show why.

## How

```text
rating
  +
optional comment
  ↓
stored anonymously against rated user
  ↓
profile samples one previous comment
```

The sampled comment is displayed with the score from the rating event that produced it.

## Limits

Hard limits for the initial prototype:

```text
maximum 420 characters
maximum 88 words
```

The first reached limit wins.

## Presentation

Comments should feel like short reputation annotations, not forum threads.

The profile may surface one sampled comment at a time instead of building another comment
feed.

## Open design

Sampling rules are not finalized.
