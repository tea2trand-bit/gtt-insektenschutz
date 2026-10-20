CREATE TABLE gtt_records (
  id text PRIMARY KEY,
  source text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  original jsonb NOT NULL,
  document jsonb NOT NULL,
  revision integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE gtt_record_history (
  record_id text NOT NULL REFERENCES gtt_records(id),
  revision integer NOT NULL,
  at timestamptz NOT NULL DEFAULT now(),
  actor text NOT NULL,
  kind text NOT NULL,
  snapshot jsonb NOT NULL,
  PRIMARY KEY (record_id, revision)
);
CREATE TABLE gtt_record_files (
  id uuid PRIMARY KEY,
  record_id text NOT NULL REFERENCES gtt_records(id),
  name text NOT NULL,
  content_type text NOT NULL,
  content bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (octet_length(content) BETWEEN 1 AND 2097152)
);
CREATE INDEX gtt_records_recent ON gtt_records (received_at DESC);
