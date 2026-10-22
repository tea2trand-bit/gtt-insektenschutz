CREATE SEQUENCE gtt_invoice_numbers;
CREATE TABLE gtt_invoices (
  id uuid PRIMARY KEY,
  record_id text NOT NULL UNIQUE REFERENCES gtt_records(id),
  quote_version bigint NOT NULL REFERENCES gtt_quote_versions(version),
  request_id uuid NOT NULL UNIQUE,
  number text NOT NULL UNIQUE,
  method text NOT NULL CHECK (method IN ('bank','cash','twint')),
  snapshot jsonb NOT NULL,
  pdf bytea,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE gtt_invoice_outbox (
  invoice_id uuid PRIMARY KEY REFERENCES gtt_invoices(id),
  status text NOT NULL CHECK (status IN ('preview_only','queued','processing','accepted','failed','unknown')),
  attempts integer NOT NULL DEFAULT 0,
  lease_until timestamptz,
  provider_id text,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
