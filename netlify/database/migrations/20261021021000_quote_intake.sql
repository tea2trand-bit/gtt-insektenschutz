CREATE TABLE gtt_quote_versions (
  version bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  record_id text NOT NULL REFERENCES gtt_records(id),
  source_fingerprint text NOT NULL,
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (record_id, source_fingerprint),
  UNIQUE (record_id, version)
);
CREATE TABLE gtt_quote_outbox (
  id text PRIMARY KEY,
  record_id text NOT NULL,
  quote_version bigint NOT NULL,
  recipient text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('offer', 'clarification')),
  idempotency_key text NOT NULL UNIQUE,
  status text NOT NULL CHECK (status IN ('preview_only','not_available','queued','processing','accepted','failed','unknown')),
  attempts integer NOT NULL DEFAULT 0,
  lease_until timestamptz,
  provider_id text,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (record_id,quote_version) REFERENCES gtt_quote_versions(record_id,version),
  UNIQUE (record_id,quote_version,recipient,kind)
);
CREATE INDEX gtt_quote_outbox_pending ON gtt_quote_outbox(status,created_at);
