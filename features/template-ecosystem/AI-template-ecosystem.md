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

## V2 build design (design-first — not yet built)

Extends the v1 schema (which already has `templates`, `criteria`, `ratings.template_id` and one
built-in Standard template) rather than replacing it.

**Data model (proposed migration 0007):**

```text
templates:  id (= canonical_hash)  name  kind[standard|featured|community]
            author_meta_id  parent_id?(fork lineage)  published(bool)  created_at
criteria:   id  template_id  label  position  lineage_id  (stable criterion identity)
```

- v1's `tpl-standard` becomes `kind='standard'`, `published=1`, `parent_id=NULL`.
- **Canonicalization + dedup:** the canonical form is the ordered list of
  `(lineage_id | normalized-label, position)`; `canonical_hash = sha256(canonicalJSON)` is the
  template id. Two submissions with the same canonical form collapse to the same id (no unbounded
  growth). Normalized-label is used only when a criterion has no inherited `lineage_id`.
- **Immutability:** a `published` template is never mutated. "Editing" = **fork**: insert a new
  template with `parent_id = source.id`, copying criteria (each keeps its `lineage_id`; a brand-new
  criterion gets a fresh one). A label rename does NOT change `lineage_id` → criterion identity
  survives (the invariant above).
- **Stats (derived, not stored):** `uses = COUNT(ratings WHERE template_id=t)`,
  `forks = COUNT(templates WHERE parent_id=t)`.
- **Discovery order (deterministic):** Standard → Featured → Community, then `uses` desc, then
  `forks` desc, then `created_at`. So community junk never dominates.

**Endpoints (proposed):** `GET /api/templates` (tier-ordered list + stats); `POST /api/templates`
(create/fork → canonicalize → dedup-or-insert). The rich-rating UI gains a template picker + a
"fork this template" affordance.

**Deliberately out of V2 scope:** arbitrary custom calculation formulas. V2 ships the
fork/version/tier/dedup machinery over the existing criteria+weights model; first-class native
calculations/visuals (Q7) are decided before custom formulas are ever allowed to expand.

**Open questions:** how **Featured** is assigned (proposed: an operator-curated flag, not
community-earnable in v2); Q7 (template calculus primitives) stays open.

## Documentation update requirement

After implementing or materially changing this feature, update the relevant PoAG
documentation in this feature directory and all directly affected linked documents.

Update [PoAG.md](../../PoAG.md) when project-level state changes.

Update the operational decision log when an operational decision changes.

Do not consider implementation complete while relevant documentation is stale.
