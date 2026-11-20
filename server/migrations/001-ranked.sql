CREATE TABLE IF NOT EXISTS ranked_pilots (
  id text COLLATE "C" PRIMARY KEY,
  cookie_hash text UNIQUE NOT NULL,
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 2 AND 24),
  created_at bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS ranked_attempts (
  id text COLLATE "C" PRIMARY KEY,
  pilot_id text NOT NULL REFERENCES ranked_pilots(id),
  board_key text COLLATE "C" NOT NULL,
  board jsonb NOT NULL,
  issued_at bigint NOT NULL,
  expires_at bigint NOT NULL CHECK (expires_at > issued_at),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'accepted', 'rejected', 'cancelled')),
  replay_hash text,
  rejection_code text
);
CREATE INDEX IF NOT EXISTS ranked_attempts_owner ON ranked_attempts(pilot_id, status, expires_at);

CREATE TABLE IF NOT EXISTS ranked_entries (
  id text COLLATE "C" PRIMARY KEY REFERENCES ranked_attempts(id),
  pilot_id text NOT NULL REFERENCES ranked_pilots(id),
  board_key text COLLATE "C" NOT NULL,
  board jsonb NOT NULL,
  display_name text NOT NULL,
  metrics jsonb NOT NULL,
  score bigint[] NOT NULL CHECK (cardinality(score) BETWEEN 1 AND 3 AND 0 <= ALL(score)),
  submitted_at bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS ranked_entries_order ON ranked_entries(board_key, score, submitted_at, id);
CREATE INDEX IF NOT EXISTS ranked_entries_owner ON ranked_entries(pilot_id, board_key, score, submitted_at, id);

CREATE TABLE IF NOT EXISTS ranked_bests (
  pilot_id text NOT NULL REFERENCES ranked_pilots(id),
  board_key text COLLATE "C" NOT NULL,
  entry_id text COLLATE "C" NOT NULL REFERENCES ranked_entries(id),
  score bigint[] NOT NULL,
  submitted_at bigint NOT NULL,
  PRIMARY KEY (pilot_id, board_key)
);

-- Fixed windows are shared across processes. Store a digest of the client address, never its raw value.
CREATE TABLE IF NOT EXISTS ranked_throttles (
  subject text NOT NULL,
  action text NOT NULL,
  window_start bigint NOT NULL,
  count integer NOT NULL CHECK (count > 0),
  PRIMARY KEY (subject, action)
);
