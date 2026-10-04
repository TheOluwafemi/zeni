-- Launch tooling: feedback, error logs and anonymous usage counts. None of it identifies a person
-- beyond the public nickname someone chooses to attach to feedback.

-- Messages sent from the Send feedback form. `contact` is optional and only if the sender typed one.
CREATE TABLE feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  message TEXT NOT NULL,
  contact TEXT,
  player_id TEXT,   -- set only if the sender was signed in
  nickname TEXT,
  version TEXT,     -- which build of the app they were running
  screen TEXT,      -- where they were: home, game, online...
  user_agent TEXT
);

-- Errors, one row per distinct problem per day with a count, so a bug that fires a thousand times
-- is one row rather than a thousand.
CREATE TABLE error_log (
  day TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  source TEXT NOT NULL,   -- client, server, room, matchmaker
  message TEXT NOT NULL,
  stack TEXT,
  screen TEXT,
  version TEXT,
  user_agent TEXT,
  count INTEGER NOT NULL DEFAULT 1,
  first_at INTEGER NOT NULL,
  last_at INTEGER NOT NULL,
  PRIMARY KEY (day, fingerprint)
);

-- Anonymous daily counters with no identifier at all: app opens, games against the computer,
-- online games started. Written by the server.
CREATE TABLE daily_counters (
  day TEXT NOT NULL,
  name TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, name)
);

-- Which signed-in players were seen on which day (for "daily players"). One row per player per day.
CREATE TABLE daily_active (
  day TEXT NOT NULL,
  player_id TEXT NOT NULL,
  PRIMARY KEY (day, player_id)
);

-- When the game began, so "average match length" and "started vs finished" can be worked out.
ALTER TABLE matches ADD COLUMN started_at INTEGER;
