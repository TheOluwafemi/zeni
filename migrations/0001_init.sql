-- Players: no personal data. A player is a public nickname plus a secret code (stored hashed).
CREATE TABLE players (
  id TEXT PRIMARY KEY,
  nickname TEXT NOT NULL UNIQUE COLLATE NOCASE,
  code_hash TEXT NOT NULL UNIQUE,
  rating INTEGER NOT NULL DEFAULT 1000,
  games INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  draws INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_players_rating ON players(rating DESC);

-- One row per finished online game.
CREATE TABLE matches (
  id TEXT PRIMARY KEY,
  p0 TEXT NOT NULL,
  p1 TEXT NOT NULL,
  score0 INTEGER NOT NULL,
  score1 INTEGER NOT NULL,
  winner TEXT,          -- player id, or NULL for a draw
  reason TEXT NOT NULL, -- normal | forfeit | timeout | resign
  created_at INTEGER NOT NULL
);

-- Fixed-window counters for abuse limits (the Workers rate-limit binding only does 10s/60s windows).
CREATE TABLE rate_limits (
  key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL
);
