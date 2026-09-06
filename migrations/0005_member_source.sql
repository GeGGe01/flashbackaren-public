-- Canonical source reference for a member (the public Flashback profile URL). Source metadata so
-- future ingest regressions are debuggable without guessing where a record came from.
ALTER TABLE members ADD COLUMN source_url TEXT;
