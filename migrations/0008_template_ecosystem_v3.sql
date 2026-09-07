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
UPDATE template_version SET
  name = (SELECT name FROM template WHERE template.id = template_version.template_id),
  description = 'Standardmall: kunskap, humor, hjälpsamhet, kvalitet.',
  calculation_config = '{"kind":"native","aggregator":"weighted_mean","modifiers":[]}',
  presentation_config = '{"result":"stars","detail":"bars"}',
  change_note = 'Initial version.'
WHERE id = 'tplv-standard-v1';

UPDATE template SET tier = 'standard', status = 'active',
  author_identity_id = 'system', current_version_id = 'tplv-standard-v1'
  WHERE id = 'tpl-standard';
-- Any other pre-existing template rows: author defaults to 'system' if it was NULL.
UPDATE template SET author_identity_id = 'system' WHERE author_identity_id IS NULL;

-- Standard criteria: 0..5 half-step scales, default weight 1.000, all active.
UPDATE template_criterion SET
  type = 'scale', default_active = 1,
  default_weight_milli = CAST(ROUND(weight_default * 1000) AS INTEGER),
  scoring_config = '{"min":0,"max":5,"step":0.5}',
  presentation_config = '{"kind":"stars"}'
WHERE template_version_id = 'tplv-standard-v1';

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
