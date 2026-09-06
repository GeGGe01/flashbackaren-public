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

## V2 domain model — FROZEN (2026-09-06, per Dexter review)

Do NOT ALTER the v1 tables incrementally into an ecosystem. Freeze the model first and build it as
ONE migration (0007). The load-bearing rule: **template identity ≠ template version.** A template is
a *work* ("Forumdebattör"); a version is an *immutable* snapshot of that work ("…v3"). Ratings and
forks bind to a **version**, never to the mutable work, so genealogy can't start lying when a work
keeps evolving.

**Entities (migration 0007):**

```text
template          id PK · root_template_id · name · author_identity · created_at
template_version  id PK · template_id → template · version_no · parent_version_id? (the EXACT
                  version this was forked/derived from; NULL for a root's v1) · canonical_hash ·
                  tier [standard|featured|community] · published_at   (immutable once published)
criterion         id PK · created_at            (STABLE identity — the "lineage id")
template_criterion  template_version_id → template_version · criterion_id → criterion ·
                    label · position · weight_default   PK(template_version_id, criterion_id)
```

- **Label lives on `template_criterion` (per version), not on `criterion`.** So renaming "Kunskap"
  → "Ämneskunskap" is a new version's join row with a new label but the SAME `criterion_id` —
  criterion identity survives the rename (the invariant).
- **Edit vs fork.** The template's author *editing* → a new `template_version` of the SAME template
  (`parent_version_id` = the previous version). Anyone *forking* → a NEW template (new work, new
  `author_identity`), whose first version's `parent_version_id` = the exact source version and whose
  `root_template_id` chains to the source's root. Published versions are never mutated.
- **Canonicalization + dedup at the VERSION level.** `canonical_hash = sha256` of the ordered
  `(criterion_id, position, weight_default)` set. Two versions with the same canonical form dedup to
  one — no unbounded growth.
- **Ratings bind to the version.** `ratings.template_version_id` replaces `ratings.template_id`, so
  we can later reconstruct exactly what a rater judged against. (Resolved ledger: yes.)
- **Weights are non-negative numbers**, not the 1–5 skeleton scale (fold this in now since we're
  cutting the schema anyway; UI offers presets AND exact weighting later).
- **Stats (derived):** `uses` = ratings whose `template_version_id` belongs to the template;
  `forks` = templates whose first version's `parent_version_id` belongs to the template.
- **Discovery (deterministic):** Standard → Featured → Community, then `uses` desc, `forks` desc,
  `published_at`. Community junk never dominates.

**Data migration in 0007:** create the new tables; migrate `tpl-standard` → one `template` +
`template_version`(v1, tier=standard) + its `criteria` → `criterion` rows + `template_criterion`
join; backfill `ratings.template_version_id` from that standard version; retire the old
`templates`/`criteria` tables. One pass, not incremental.

**Endpoints:** `GET /api/templates` (tier-ordered list + stats); `POST /api/templates`
(create/fork → canonicalize → dedup-or-insert a version). Rich-rating UI gains a template picker +
"fork this template".

**Resolved ledger calls (Dexter defaults — operator adjusts in review):**
- **Featured = operator-curated flag** (a `tier` value only the operator sets), not community-earnable in v2.
- **Rating revisions: current-state only in v1** (still one current rating per (rater,target)); a
  history table comes later. Switching template replaces the current rating.

**Out of V2 scope:** arbitrary custom calculation formulas. V2 ships fork/version/tier/dedup over the
existing criteria+weights model; first-class native calculations/visuals (Q7) are decided before any
custom formula is allowed to expand.

## Documentation update requirement

After implementing or materially changing this feature, update the relevant PoAG
documentation in this feature directory and all directly affected linked documents.

Update [PoAG.md](../../PoAG.md) when project-level state changes.

Update the operational decision log when an operational decision changes.

Do not consider implementation complete while relevant documentation is stale.
