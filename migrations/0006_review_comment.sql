-- Optional free-text review attached to a rater's rating of a target. One per (rater, target),
-- like the rating itself. Hard limits (≤420 chars AND ≤88 words) are enforced in the worker.
-- This is our OWN stored user content — the point where BBS-lagen supervision applies (operator
-- stance: remove directly-illegal content).
ALTER TABLE ratings ADD COLUMN comment TEXT;
