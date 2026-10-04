-- Not every game moves ratings: very short ones and repeat pairings don't (see server/ratings.ts).
ALTER TABLE matches ADD COLUMN rated INTEGER NOT NULL DEFAULT 1;
-- Finding a pair's recent games, and a player's recent opponents.
CREATE INDEX idx_matches_p0 ON matches(p0, created_at);
CREATE INDEX idx_matches_p1 ON matches(p1, created_at);
