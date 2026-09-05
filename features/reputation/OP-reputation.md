---
title: Reputation
status: prototype
major: v1
fork: F0
---

# Reputation

## Why — 30 seconds

A post is temporary. A user is the constant.

Flashbackaren therefore rates the user's contribution over time instead of counting likes
on isolated posts.

## How

```text
direct rating ───────────────┐
                             ├─→ user rating
criteria + weights ──────────┘
           ↓
     activity component
           ↓
      final reputation
```

The visible scale is 0–5 stars with half-star steps.

That gives ten practical steps without making the interface look like a 0–10 scoring app.

## Two ways to rate

### Direct

Set the final score directly.

### Rich

Rate selected criteria such as:

```text
Knowledge      4.8
Humor          2.5
Helpfulness    4.6
Quality        4.4
```

The rater may weight criteria differently.

## Activity

Current prototype formula:

```text
R = min(5, B + 0.1P)
```

B is the aggregated rating.

P is average Flashback posts per day.

Activity is not quality. It is a separate component.

## What it should feel like

A rating should be fast if the user wants it fast, but arbitrarily nerdy if the user wants
to build a richer assessment.

## Limitations

The final aggregation formula is still open to revision.

## Where it could live

The rating engine should remain independent enough to survive if the template system or
Flashback-specific presentation later splits into another project.
