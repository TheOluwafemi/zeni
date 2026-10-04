-- Challenges: "Bea challenged you". Each one has a room reserved for the two players.
CREATE TABLE challenges (
  id TEXT PRIMARY KEY,
  from_id TEXT NOT NULL,
  to_id TEXT NOT NULL,
  room TEXT NOT NULL,
  table_kind TEXT NOT NULL,  -- easy | hard
  status TEXT NOT NULL,      -- open | accepted | declined | cancelled | started
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX idx_challenges_to ON challenges(to_id, expires_at);
CREATE INDEX idx_challenges_from ON challenges(from_id, expires_at);
CREATE INDEX idx_challenges_room ON challenges(room);
