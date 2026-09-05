---
title: Template ecosystem
status: prototype
major: v1
fork: F0
---

# Template ecosystem

## Why — 30 seconds

One rating model is boring.

Let users decide what "good" means, then let those definitions evolve through natural use.

## How

```text
Standard
   ↓
Featured
   ↓
Community
   ↓
fork → modify → publish → fork again
```

Templates can define:
- criteria;
- labels;
- weights;
- calculation behavior;
- visual presentation.

## Discovery

Priority:

```text
1. Standard
2. Featured
3. Community
```

Community trash may exist without dominating the interface.

## Limits

Initial hard limit:

```text
maximum active criteria = 10
```

Limits should be relaxed only when real usage proves the need.

## Genealogy

Forked templates should retain enough ancestry to identify modified descendants.

A criterion may preserve genealogical identity even when its display label changes.

## What it should feel like

Some templates may be serious.

Some may be absurd.

The system should be more configurable than the problem deserves, while the presentation
makes that excess understandable and fun.

## Where it could live

The template engine should be detachable from Flashback-specific identity so it can become
a reusable rating primitive later.
