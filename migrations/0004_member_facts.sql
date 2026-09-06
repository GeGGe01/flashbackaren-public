-- Facts we can carry per member (still facts, never content): registration date and post count.
-- Post count + account age feed the activity component later (Q1: R = min(5, B + 0.1P)).
ALTER TABLE members ADD COLUMN posts    INTEGER;
ALTER TABLE members ADD COLUMN reg_date TEXT;
