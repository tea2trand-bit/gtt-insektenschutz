CREATE TABLE gtt_pending_inquiries (
  id text PRIMARY KEY,
  source text NOT NULL,
  received_at timestamptz NOT NULL,
  original jsonb NOT NULL,
  staged_at timestamptz NOT NULL DEFAULT now()
);
