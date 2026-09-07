-- Template ecosystem V3 — batch A (schema/domain). Forward-only evolution of the 0007 tables into the
-- V3 product contract (features/template-ecosystem/AI-template-ecosystem-v3.md). 0007 already shipped
-- (and is applied to the remote D1), so this migrates it forward; it never rewrites 0007.
--
-- Design note: we ADD + backfill only — no table recreates. SQLite can't DROP a table that another
-- table's FK references (template_version -> template), and recreates on a live-migrated remote are
-- risky. So retired 0007 columns (template.name, template_version.canonical_hash/tier,
-- template_criterion.weight_default) simply become VESTIGIAL — the V3 code stops reading them. New V3
-- template rows still set the (NOT NULL) template.name denormalised to the current version name.
--
-- Batch A scope: SHAPE + data migration only — score_bp, generic criterion values, Template /
-- TemplateVersion V3 fields, versioned criterion-slot config, criterion types, tier-on-work.
-- Calculation engine (B), publishing (C), hash population (D — snapshot_hash/logic_hash are created
-- here, left NULL for D to compute), API validation (E) come later.

-- 1. template: tier moves onto the WORK; add status + current_version_id + author_identity_id.
--    (0007's template.name stays as a vestigial NOT NULL column, kept denormalised by V3 inserts.)
ALTER TABLE template ADD COLUMN tier TEXT NOT NULL DEFAULT 'community'
  CHECK (tier IN ('standard', 'featured', 'community'));
ALTER TABLE template ADD COLUMN status TEXT NOT NULL DEFAULT 'active'
  CHECK (status IN ('active', 'archived', 'hidden'));
ALTER TABLE template ADD COLUMN current_version_id TEXT;
ALTER TABLE template ADD COLUMN author_identity_id TEXT;

-- 2. template_version: versioned user-visible + config fields. (0007's canonical_hash + tier stay
--    vestigial; V3 reads snapshot_hash/logic_hash — populated in batch D — and template.tier.)
ALTER TABLE template_version ADD COLUMN name TEXT;
ALTER TABLE template_version ADD COLUMN description TEXT;
ALTER TABLE template_version ADD COLUMN calculation_config TEXT;   -- JSON; default seeded below
ALTER TABLE template_version ADD COLUMN presentation_config TEXT;  -- JSON; default seeded below
ALTER TABLE template_version ADD COLUMN snapshot_hash TEXT;        -- batch D
ALTER TABLE template_version ADD COLUMN logic_hash TEXT;           -- batch D
ALTER TABLE template_version ADD COLUMN change_note TEXT;

-- 3. criterion slot config: versioned + typed. weight_default (0007, REAL) stays vestigial;
--    default_weight_milli (fixed-point, arbitrary relative weights) is authoritative in V3.
ALTER TABLE template_criterion ADD COLUMN description TEXT;
ALTER TABLE template_criterion ADD COLUMN type TEXT NOT NULL DEFAULT 'scale'
  CHECK (type IN ('scale', 'boolean', 'ordinal', 'percentage', 'bipolar'));
ALTER TABLE template_criterion ADD COLUMN default_active INTEGER NOT NULL DEFAULT 1
  CHECK (default_active IN (0, 1));
ALTER TABLE template_criterion ADD COLUMN default_weight_milli INTEGER NOT NULL DEFAULT 1000
  CHECK (default_weight_milli >= 0);
ALTER TABLE template_criterion ADD COLUMN scoring_config TEXT;      -- JSON per type
ALTER TABLE template_criterion ADD COLUMN presentation_config TEXT; -- JSON

-- 4. Backfill the Standard version's V3 fields + the work's tier/author/current version.
-- NOTE: 0007 shipped POST /api/templates, so this migration must handle EXISTING V2 community
-- templates/versions/criteria too — not just the Standard seed. It migrates ALL rows generically and
-- PRESERVES V2 ownership + weights; only the system Standard is re-owned to 'system'.

-- (a) Standard system seed — dual hashes hardcoded (fresh DBs contain only this row). The literals
-- are precomputed with the SAME src/template.ts snapshotHash/logicHash over loadVersion()'s shape of
-- this seed; a unit test asserts the code reproduces them (drift guard, P0-8).
UPDATE template_version SET
  name = 'Standard',
  description = 'Standardmall: kunskap, humor, hjälpsamhet, kvalitet.',
  calculation_config = '{"kind":"native","aggregator":"weighted_mean","modifiers":[]}',
  presentation_config = '{"result":"stars","detail":"bars"}',
  change_note = 'Initial version.',
  snapshot_hash = '27eec025e04c9e4d8aa1ee0075397c3cd0cc698de1bc4d7cde9b3ba4833a6830',
  logic_hash = '63a2f1a9417e5a7168dbbb19d4fccd93fdb3fb67591b20cb01dfbd0f819e5271'
WHERE id = 'tplv-standard-v1';

-- (b) Every OTHER pre-existing V2 version: fill the V3 structural fields with V2-equivalent semantics
-- (name denormalised from the V2 template.name; weighted_mean; stars/bars). snapshot_hash/logic_hash
-- are LEFT NULL and backfilled deterministically AFTER migration by POST /api/admin/backfill-hashes
-- (same hash impl as runtime publication) — a hardcoded literal cannot cover dynamic community rows.
UPDATE template_version SET
  name = COALESCE(name, (SELECT name FROM template WHERE template.id = template_version.template_id)),
  description = COALESCE(description, ''),
  calculation_config = COALESCE(calculation_config, '{"kind":"native","aggregator":"weighted_mean","modifiers":[]}'),
  presentation_config = COALESCE(presentation_config, '{"result":"stars","detail":"bars"}'),
  change_note = COALESCE(change_note, 'Migrated from V2.')
WHERE id != 'tplv-standard-v1';

-- (c) Every WORK: PRESERVE V2 ownership (author_identity -> author_identity_id, NOT 'system'); tier
-- from the work's latest 0007 version tier; current_version_id = latest version; status active.
UPDATE template SET
  author_identity_id = COALESCE(author_identity_id, author_identity),
  status = COALESCE(status, 'active'),
  tier = COALESCE(
    (SELECT tv.tier FROM template_version tv WHERE tv.template_id = template.id ORDER BY tv.version_no DESC LIMIT 1),
    tier),
  current_version_id = COALESCE(
    current_version_id,
    (SELECT tv.id FROM template_version tv WHERE tv.template_id = template.id ORDER BY tv.version_no DESC LIMIT 1));
-- The Standard work is system-owned/canonical (only this one is re-owned).
UPDATE template SET tier = 'standard', author_identity_id = 'system' WHERE id = 'tpl-standard';

-- (d) Every criterion: typed scale, active, weight PRESERVED from V2 weight_default (e.g. 2.5 -> 2500).
UPDATE template_criterion SET
  type = COALESCE(type, 'scale'),
  default_active = COALESCE(default_active, 1),
  default_weight_milli = CAST(ROUND(weight_default * 1000) AS INTEGER),
  scoring_config = COALESCE(scoring_config, '{"min":0,"max":5,"step":0.5}'),
  presentation_config = COALESCE(presentation_config, '{"kind":"stars"}');

-- 5. ratings: canonical score in basis points + a stable rating id (RatingCriterionValue.rating_id).
--    score_halfsteps stays for the direct-input representation + the (unchanged) global aggregation.
ALTER TABLE ratings ADD COLUMN id TEXT;
ALTER TABLE ratings ADD COLUMN score_bp INTEGER;
UPDATE ratings SET
  id = rater_meta_id || ':' || target_uid,
  score_bp = CAST(score_halfsteps AS INTEGER) * 1000     -- halfsteps 0..10 -> bp 0..10000
  WHERE id IS NULL OR score_bp IS NULL;
CREATE UNIQUE INDEX idx_ratings_id ON ratings (id);

-- 6. rating_criteria -> rating_criterion_value: generic raw + normalized + milli weight, keyed by the
--    rating id. raw_value_json preserves the original input; normalized_score_bp is the 0..10000 score.
CREATE TABLE rating_criterion_value (
  rating_id           TEXT NOT NULL,
  criterion_id        TEXT NOT NULL REFERENCES criterion (id),
  raw_value_json      TEXT NOT NULL,
  normalized_score_bp INTEGER NOT NULL CHECK (normalized_score_bp BETWEEN 0 AND 10000),
  weight_milli        INTEGER NOT NULL CHECK (weight_milli >= 0),
  PRIMARY KEY (rating_id, criterion_id)
);
INSERT INTO rating_criterion_value (rating_id, criterion_id, raw_value_json, normalized_score_bp, weight_milli)
  SELECT rc.rater_meta_id || ':' || rc.target_uid,
         rc.criterion_id,
         '{"kind":"scale","halfsteps":' || rc.score_halfsteps || '}',
         CAST(rc.score_halfsteps AS INTEGER) * 1000,
         CAST(ROUND(rc.weight * 1000) AS INTEGER)
    FROM rating_criteria rc;
DROP TABLE rating_criteria;
