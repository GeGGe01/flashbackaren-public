-- DEMO seed only. These are synthetic placeholder members so the find→rate→see loop works
-- offline. They are NOT real Flashback users. Real member indexing (upstream lookup on miss,
-- the Q5 pre-seed of early members/moderators) is deferred to a later slice — deliberately,
-- so the see-and-feel skeleton rates no real person.

INSERT OR IGNORE INTO members (uid, username, first_seen, last_seen) VALUES
  ('demo-1', 'demo_alice',  '2026-09-05T00:00:00Z', '2026-09-05T00:00:00Z'),
  ('demo-2', 'demo_bengt',  '2026-09-05T00:00:00Z', '2026-09-05T00:00:00Z'),
  ('demo-3', 'demo_carola', '2026-09-05T00:00:00Z', '2026-09-05T00:00:00Z'),
  ('demo-4', 'demo_dexter', '2026-09-05T00:00:00Z', '2026-09-05T00:00:00Z'),
  ('demo-5', 'demo_erik',   '2026-09-05T00:00:00Z', '2026-09-05T00:00:00Z');
