CREATE TABLE gtt_team_outbox (
 id text PRIMARY KEY,
 record_id text NOT NULL REFERENCES gtt_records(id),
 quote_version bigint NOT NULL,
 kind text NOT NULL CHECK(kind IN ('new_inquiry','customer_acceptance')),
 message jsonb NOT NULL,
 status text NOT NULL CHECK(status IN ('queued','processing','accepted','failed','unknown')),
 attempts integer NOT NULL DEFAULT 0,
 lease_until timestamptz,
 provider_id text,
 error_code text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(record_id,quote_version,kind)
);
