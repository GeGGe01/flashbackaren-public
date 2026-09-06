-- Rich (multi-criteria, weighted) rating. A rater can score several criteria from a template,
-- each with its own weight; the stored overall rating is the weighted mean. Templates and their
-- criteria are their own tables (the template ECOSYSTEM — forking, tiers — is a later horizon;
-- v1 ships one built-in Standard template so rich rating works).

CREATE TABLE IF NOT EXISTS templates (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  kind       TEXT NOT NULL DEFAULT 'standard',   -- standard | featured | community (v1: standard)
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS criteria (
  id          TEXT PRIMARY KEY,
  template_id TEXT NOT NULL REFERENCES templates (id),
  label       TEXT NOT NULL,
  position    INTEGER NOT NULL
);

-- The per-criterion breakdown of one rater's rich rating for a target. The overall rating still
-- lives in `ratings` (as the weighted mean) so aggregation is unchanged; this holds the detail.
CREATE TABLE IF NOT EXISTS rating_criteria (
  rater_meta_id   TEXT NOT NULL,
  target_uid      TEXT NOT NULL,
  criterion_id    TEXT NOT NULL REFERENCES criteria (id),
  score_halfsteps INTEGER NOT NULL CHECK (score_halfsteps BETWEEN 0 AND 10),
  weight          INTEGER NOT NULL CHECK (weight BETWEEN 1 AND 5),
  PRIMARY KEY (rater_meta_id, target_uid, criterion_id)
);

-- How the overall rating was produced.
ALTER TABLE ratings ADD COLUMN mode        TEXT NOT NULL DEFAULT 'direct';  -- direct | rich
ALTER TABLE ratings ADD COLUMN template_id TEXT;

-- The one built-in Standard template (criteria from the reputation design: Knowledge, Humor,
-- Helpfulness, Quality). Max 10 criteria per template is enforced in the worker.
INSERT OR IGNORE INTO templates (id, name, kind, created_at) VALUES
  ('tpl-standard', 'Standard', 'standard', '2026-09-05T00:00:00Z');

INSERT OR IGNORE INTO criteria (id, template_id, label, position) VALUES
  ('crit-knowledge',   'tpl-standard', 'Kunskap',     1),
  ('crit-humor',       'tpl-standard', 'Humor',       2),
  ('crit-helpfulness', 'tpl-standard', 'Hjälpsamhet', 3),
  ('crit-quality',     'tpl-standard', 'Kvalitet',    4);
