---
feature: template-ecosystem
contract: v3
status: authoritative
supersedes: AI-template-ecosystem.md "V2 domain model — FROZEN"
---

# Template ecosystem — V3 product contract (authoritative)

> This is the load-bearing spec. The V2 model in `AI-template-ecosystem.md` was an **exploratory
> implementation, superseded by this V3 product contract.** V3 hardens the domain model BEFORE any
> further UI polish. Do not spend effort on visual styling before batches A–E (below) are stable;
> the current Flashback-like skeleton is sufficient until the product contract is correct.

## Load-bearing invariants (document prominently; implementation MUST obey)

- **Templates are logical works.** A `Template` = one logical work/product.
- **Published versions are immutable.** A `TemplateVersion` = an immutable published snapshot of one
  `Template`. A published version MUST NEVER mutate.
- **Revisions stay in the same template.** A *revision* is a new `TemplateVersion` of the SAME
  `Template` (`X/v1 → X/v2 → X/v3`). Only the template owner may publish a revision.
- **Forks create a new template.** A *fork* is a NEW `Template` whose `v1.parent_version_id` = the
  exact source `TemplateVersion` (another user forking `X/v2` → `Y/v1`, `Y` a new work).
- **Ratings bind the exact version.** A rating MUST remain bound to the exact `TemplateVersion` used
  when submitted, and must never change appearance/meaning because the template was renamed/redesigned
  later.
- **Criterion lineage is stable.** `criterion_id` is server-owned and stable across relabels; a
  rename keeps the id, a new concept gets a new id. The server never infers rename-vs-replace — the
  client editor decides; the client may not spoof arbitrary existing criterion ids.
- **Zero != not-rated.** Zero is a valid score; not-rated is absence of a criterion value. Only
  active/rated criteria are submitted/evaluated.
- **Server is authoritative for score.** The persisted result/receipt derives from server evaluation,
  not the frontend preview.
- **Author comes from server identity.** `author_identity_id` is derived from the current local/meta
  identity, NEVER accepted from the request body.
- **Historical state is never silently rewritten.** No destructive dedup of published genealogy; no
  silent migration of an existing rating to a newer version; archive/hide, never delete referenced data.

## P0 — schema V3

```text
Template
  id · root_template_id · author_identity_id · tier · status · created_at · current_version_id

TemplateVersion
  id · template_id · version_no · parent_version_id · name · description
  · calculation_config · presentation_config · snapshot_hash · logic_hash · change_note · published_at
```

Versioned user-visible properties live on `TemplateVersion` (not `Template`) wherever needed for
historical reproducibility — so a historical rating never changes appearance/meaning after a later
rename/redesign.

### Criterion model (versioned slot config on the version's criteria)

```text
criterion slot: criterion_id · label · description · type · position
              · default_active · default_weight · scoring_config · presentation_config
```

Criterion types shipped in the first proper engine:
- **scale** — e.g. min 0, max 5, step 0.5
- **boolean** — Ja/Nej with a configured normalized-score mapping
- **ordinal** — e.g. Usel/Dålig/Okej/Bra/Utmärkt; each option maps to a normalized score
- **percentage** — 0–100
- **bipolar** — e.g. Pedantisk ↔ Kaotisk

Descriptive-only criteria are allowed: `weight = 0`, not part of the final score. Max active/available
criteria in V1 remains **10**.

### Criterion lineage security (server-owned)
- New root template → server mints all criterion ids.
- Fork → a reused `criterion_id` MUST exist in the source `TemplateVersion`.
- Revision → a reused `criterion_id` MUST exist in the previous lineage.
- New conceptual criterion → new `criterion_id`. Rename/relabel → preserve `criterion_id`.
- Client decides rename-vs-replace; server does not infer; client cannot spoof arbitrary ids.

## P0 — generic criterion value storage

`score_halfsteps` is insufficient once types expand. `RatingCriterionValue`:

```text
rating_id · criterion_id · raw_value_json · normalized_score_bp · weight_milli
```

Preserve BOTH raw user input and normalized score, so old ratings stay fully reproducible from the
stored version + values. Examples: ordinal raw `"utmärkt"` → `normalized_score_bp 10000`; percentage
raw `73` → `7300`.

## P0 — score precision (basis points)

Do NOT round rich calculated scores back to half-stars. Input scale may still use half-stars.

- Canonical output `score_bp` = integer `0..10000` (`0 = 0.00/5`, `10000 = 5.00/5`).
- `display_score = score_bp / 2000` (e.g. `8734 → 4.367`).
- Direct 4.5-star rating → `9000`. Rich calculated result → any bp value.
- Global profile UI chooses display precision separately (e.g. 2 decimals).

## P0 — weights (arbitrary, relative)

Arbitrary weighting must work end-to-end. The 1–5 UI cap is temporary skeleton behaviour and is to be
removed. Weights are relative (need not sum to 100); normalize for display. Store as fixed-point
integer `weight_milli` (`73 → 73000`, `2.5 → 2500`). Do not hash/compare raw IEEE floats. `weight = 0`
allowed for descriptive criteria.

## P0 — calculation pipeline (single, server-authoritative)

`raw input → validation → normalization to 0..1/0..10000 → aggregation → modifiers → canonical
template score → 0..5 representation`.

- V1 native aggregators: `weighted_mean`, `mean`, `median`, `minimum`, `maximum`.
- V1 modifiers: `threshold`, `cap`, `veto`. (cap e.g. "if Källkritik < 1.5, total ≤ 2.0"; veto e.g.
  "if criterion X matches configured value, final = 0".)
- Calculation config is versioned in `TemplateVersion`.

**Expression engine (P1, model now / implement after natives):** reserve `calculation.kind =
native | expression`. A future expression language allows only safe primitives (`+ - * / ()`,
`min max avg clamp`, criterion refs). NO eval/JS/loops/property-traversal/arbitrary calls. The parser
need not ship in the first batch, but the schema must not block it.

## P0 — canonical hashing (two hashes; neither erases genealogy)

The V2 single-hash dedup is wrong for published history. A relabel (same `criterion_id`, label
`"Kunskap" → "Ämneskunskap"`) MUST be a new `TemplateVersion`, not deduped back.

- **snapshot_hash** — all versioned published state: name, description, criterion order, labels,
  criterion descriptions, criterion config/types, weights, calculation config, presentation config.
  (Exact-duplicate detection.)
- **logic_hash** — score semantics: criterion scoring config, weights, calculation logic; excludes
  cosmetic/presentation-only differences where appropriate. (Similarity / "same model, different
  presentation".)

Neither hash may erase legitimate published genealogy. Flood control is **quotas + discovery
behaviour**, NOT destructive historical dedup.

## P0 — tier semantics (on the Template, not the version)

Tiers: `standard` (system-owned/canonical), `featured` (editorially featured), `community`.
- Tier belongs to the logical work; publishing a new version must not silently demote featured.
- Operator promotes/demotes `community ↔ featured` without mutating published versions.

## P0 — global reputation stays separate

Template engine answers "how does one rater derive their final rating?"; the global reputation engine
answers "how are raters' final ratings aggregated?". Do not merge them. Global community score stays
`B = mean(current ratings)`; activity `R = min(5, B + 0.1·P)`. No template weights leak into cross-user
aggregation after each rating produced its canonical final score. No status/laidback weighting of
individual ratings.

## P1 — surfaces (after A–E; not before)
- **Presentation config** — separate score maths from visuals. Result presentations: stars, numeric,
  percentage, grade, symbol set. Detail presentations: bars, radar, scorecard, bipolar meter. Applies
  to editor / receipt / review card / preview / detail — MUST NOT override the canonical global
  reputation presentation on the member profile (global profile stays comparable across templates).
- **Show calculation** — server emits an authoritative evaluation trace (per-criterion
  `value × weight% = contribution`, total, modifiers). "Visa beräkningen" renders the server trace;
  frontend preview may compute independently but the persisted receipt derives from server evaluation.
- **Library / discovery** — a dedicated surface (Standardmallar / Featured / Community), community
  sort popular|most-forked|newest, list items expose name/version/criterion-count/calc-type/uses/forks
  + Use/View; Standard & Featured always rank above Community.
- **Detail page** — name/description/author/tier/current version/published/criteria/calc summary/
  presentation preview/uses/forks; actions Use / Fork / Edit(owner); sections History / Genealogy /
  Compare-with-parent.
- **Diff/compare** — deterministic version diff keyed on stable `criterion_id` (distinguish
  rename/config-change from add/remove).
- **Old-version ratings** — show "You used vN"; offer "Switch to vLatest" as an explicit
  resubmit/replace; never silently migrate; still one current rating per (rater, target).
- **Archive/hide, not delete** — author archives (out of discovery, no new ratings, history intact);
  operator hides abuse; never physically delete referenced published data outside an explicit
  maintenance/legal path.
- **Fork/edit lifecycle** — Fork/Redigera open the editor prefilled (from exact source version /
  latest); modify → preview → publish; only publish creates the Template/Version. Closing before
  publish leaves NO server-side junk (draft state is client/local for V1). Editor should feel like an
  overengineered vBulletin settings page.

## P1 — publication limits / flood control (configurable constants)

max criteria/template 10 · template name 60 · template description 280 · criterion label 48 ·
criterion description 160 · public templates/identity 10 · publishes/24h 3 · versions/template 25
(initial). Review text stays ≤420 chars / ≤88 words (first limit reached wins). Keep as constants so
they can be loosened.

## P1 — API shape (approx)

```text
GET  /api/templates                         GET  /api/templates/:templateId
GET  /api/template-versions/:versionId       GET  /api/template-versions/:versionId/diff
POST /api/templates                          -- create root, or create fork v1 with source_version_id
POST /api/templates/:templateId/versions     -- publish revision (owner only)
POST /api/templates/:templateId/archive
```
Never accept author identity from the client; validate ownership + criterion lineage server-side.

## Acceptance contract (Ecosystem is NOT complete until all pass)

1 create custom root template · 2 publish v1 · 3 rate a member with v1 · 4 rating stores exact v1 id ·
5 owner edits · 6 publish v2 same template_id · 7 v1 immutable · 8 old rating still renders with v1 ·
9 another identity forks exact v1 · 10 fork editor opens before DB creation · 11 rename inherited
criterion · 12 publish fork v1 · 13 criterion id survives rename · 14 genealogy points to exact source
v1 · 15 diff reports rename correctly · 16 new criterion gets new id · 17 client cannot reuse arbitrary
unrelated criterion id · 18 rich score retains precision finer than 0.5★ · 19 weight >5 survives
UI→API→DB→UI · 20 decimal/fixed-point weight survives canonical hashing consistently · 21 not-rated
criterion excluded · 22 active zero score valid · 23 Standard before Featured before Community · 24
featured survives publishing a new version · 25 archived template gone from discovery but old ratings
still render · 26 client cannot spoof author · 27 existing rating on old version not silently migrated ·
28 server evaluation trace equals persisted result · 29 template presentation does not alter global
reputation presentation · 30 existing rating upsert stays atomic with criterion breakdown.

## Implementation order (batch; return branch for review after A–E, before F)

- **A. Schema/domain:** score_bp · generic criterion value · Template/TemplateVersion V3 · criterion
  config/lineage.
- **B. Calculation engine:** normalization · weighted_mean · remaining native aggregators · modifiers ·
  evaluation trace.
- **C. Publishing semantics:** create · revise · fork · ownership · archive · tier.
- **D. Hashing/diff:** snapshot_hash · logic_hash · compare-with-parent.
- **E. API validation:** author-spoof prevention · lineage validation · limits.
- **F. Frontend:** template editor · library · detail · fork/edit flows · old-version handling · show
  calculation. *(Do not start major frontend build-out until A–E reviewed.)*
- **G. Tests/docs cleanup.**

Migrations are forward-only: V2 shipped `0007` (already applied to the remote D1), so V3 evolves it via
`0008` (both local and remote apply 0008 forward) — never rewrite 0007.

## OPEN DESIGN QUESTIONS — DO NOT INVENT ANSWERS

Keep open unless implementation forces a minimal reversible decision (then note it): final global
aggregation rounding/display precision · fingerprint signal set · verification TTL/reactivation ·
historical username/meta-prefix rules · final comment sampling policy · exact expression-language V1
scope · final community publication quotas · anonymous/verified/laidback capability gates · final
IA/navigation polish · Flashbackaren mascot/brand · code + template license · whether historical rating
revisions ship in V1.
