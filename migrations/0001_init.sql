-- v1-core schema. Two tables: the member index and the ratings.
-- UID is canonical member identity; username is presentation/search only.

CREATE TABLE IF NOT EXISTS members (
  uid        TEXT PRIMARY KEY,           -- Flashback UID (canonical identity)
  username   TEXT NOT NULL,              -- stored exactly as upstream returns it (never normalized)
  first_seen TEXT NOT NULL,
  last_seen  TEXT NOT NULL
);

-- One current rating per (rater meta-identity, target member). Re-rating UPDATES, never stacks.
-- score_halfsteps is 0..10 (i.e. 0.0..5.0 stars in half-star steps) — integers avoid float drift.
CREATE TABLE IF NOT EXISTS ratings (
  rater_meta_id   TEXT NOT NULL,         -- browser-derived ownership key (NOT a person, NOT hardened in v1)
  target_uid      TEXT NOT NULL,
  score_halfsteps INTEGER NOT NULL CHECK (score_halfsteps BETWEEN 0 AND 10),
  updated_at      TEXT NOT NULL,
  PRIMARY KEY (rater_meta_id, target_uid),
  FOREIGN KEY (target_uid) REFERENCES members (uid)
);

CREATE INDEX IF NOT EXISTS idx_ratings_target ON ratings (target_uid);
