-- Template ecosystem V2 (features/template-ecosystem/AI-template-ecosystem.md, "FROZEN" model).
-- ONE migration, not incremental. Load-bearing rule: template IDENTITY != template VERSION.
-- A template is a *work*; a version is an *immutable* snapshot. Ratings and forks bind to a
-- VERSION, so genealogy stays honest as a work evolves.
--
-- Built as one pass: create the new tables, migrate the built-in Standard template into them,
-- repoint ratings + rating_criteria at the version/criterion identities, and retire the old
-- templates/criteria tables.

-- 1. New tables ------------------------------------------------------------------------------

-- A template is a WORK (mutable name/author); versions hang off it.
CREATE TABLE template (
  id               TEXT PRIMARY KEY,
  root_template_id TEXT NOT NULL,          -- root of the fork genealogy (self for a root work)
  name             TEXT NOT NULL,
  author_identity  TEXT NOT NULL,
  created_at       TEXT NOT NULL
);

-- A version is an IMMUTABLE snapshot of a template. Ratings/forks bind here.
CREATE TABLE template_version (
  id                TEXT PRIMARY KEY,
  template_id       TEXT NOT NULL REFERENCES template (id),
  version_no        INTEGER NOT NULL,
  parent_version_id TEXT REFERENCES template_version (id),  -- exact source version; NULL for a root's v1
  canonical_hash    TEXT NOT NULL,                          -- sha256 of the ordered criteria set (dedup)
  tier              TEXT NOT NULL DEFAULT 'community'
                      CHECK (tier IN ('standard', 'featured', 'community')),
  published_at      TEXT NOT NULL,
  UNIQUE (template_id, version_no)
);

-- Criterion = STABLE identity (the "lineage id"). Label lives on the join, not here — so a
-- relabel is a new join row with the SAME criterion_id (criterion identity survives a rename).
CREATE TABLE criterion (
  id         TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
);

-- Which criterion sits on which version, with the per-version label/position/default weight.
CREATE TABLE template_criterion (
  template_version_id TEXT NOT NULL REFERENCES template_version (id),
  criterion_id        TEXT NOT NULL REFERENCES criterion (id),
  label               TEXT NOT NULL,
  position            INTEGER NOT NULL,
  weight_default      REAL NOT NULL CHECK (weight_default >= 0),  -- non-negative real, not 1..5
  PRIMARY KEY (template_version_id, criterion_id)
);

CREATE INDEX idx_template_version_template ON template_version (template_id);
CREATE INDEX idx_template_version_hash     ON template_version (canonical_hash);
CREATE INDEX idx_template_criterion_version ON template_criterion (template_version_id);

-- 2. Migrate the built-in Standard template into the new model --------------------------------

INSERT INTO template (id, root_template_id, name, author_identity, created_at)
  SELECT id, id, name, 'system', created_at FROM templates WHERE id = 'tpl-standard';

-- v1 of the Standard template, tier=standard. canonical_hash precomputed with the same algorithm
-- as src/template.ts canonicalHash() over the four seed criteria (all weight_default = 1):
--   crit-knowledge:1:1|crit-humor:2:1|crit-helpfulness:3:1|crit-quality:4:1
INSERT INTO template_version
    (id, template_id, version_no, parent_version_id, canonical_hash, tier, published_at)
  VALUES
    ('tplv-standard-v1', 'tpl-standard', 1, NULL,
     '16a5c9e91fcac900aa91b98763e34220c16ae51f6f470d7312ca7103fa927009',
     'standard', '2026-09-05T00:00:00Z');

-- Criteria keep their existing ids (so rating_criteria still resolves after the repoint).
INSERT INTO criterion (id, created_at)
  SELECT id, '2026-09-05T00:00:00Z' FROM criteria WHERE template_id = 'tpl-standard';

INSERT INTO template_criterion (template_version_id, criterion_id, label, position, weight_default)
  SELECT 'tplv-standard-v1', id, label, position, 1
    FROM criteria WHERE template_id = 'tpl-standard';

-- 3. ratings: bind to the version instead of the mutable template --------------------------------

ALTER TABLE ratings ADD COLUMN template_version_id TEXT;
UPDATE ratings SET template_version_id = 'tplv-standard-v1' WHERE template_id = 'tpl-standard';
ALTER TABLE ratings DROP COLUMN template_id;

-- 4. rating_criteria: repoint criterion_id at `criterion`, widen weight to non-negative REAL ------
-- SQLite can't change a FK/CHECK in place, so recreate + copy.

CREATE TABLE rating_criteria_new (
  rater_meta_id   TEXT NOT NULL,
  target_uid      TEXT NOT NULL,
  criterion_id    TEXT NOT NULL REFERENCES criterion (id),
  score_halfsteps INTEGER NOT NULL CHECK (score_halfsteps BETWEEN 0 AND 10),
  weight          REAL NOT NULL CHECK (weight >= 0),
  PRIMARY KEY (rater_meta_id, target_uid, criterion_id)
);
INSERT INTO rating_criteria_new (rater_meta_id, target_uid, criterion_id, score_halfsteps, weight)
  SELECT rater_meta_id, target_uid, criterion_id, score_halfsteps, weight FROM rating_criteria;
DROP TABLE rating_criteria;
ALTER TABLE rating_criteria_new RENAME TO rating_criteria;

-- 5. Retire the old tables (nothing references them any more) -------------------------------------

DROP TABLE criteria;
DROP TABLE templates;
