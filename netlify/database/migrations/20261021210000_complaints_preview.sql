CREATE TABLE gtt_complaints (
  id uuid PRIMARY KEY,
  number bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  request_id uuid NOT NULL UNIQUE,
  fingerprint text NOT NULL UNIQUE,
  lookup text NOT NULL,
  email text NOT NULL,
  description text NOT NULL,
  record_id text REFERENCES gtt_records(id) ON DELETE SET NULL,
  match_status text NOT NULL CHECK (match_status IN ('matched','review')),
  match_method text NOT NULL,
  ai_status text NOT NULL,
  status text NOT NULL DEFAULT 'Offen' CHECK (status IN ('Offen','In Bearbeitung','Erledigt')),
  resolution text NOT NULL DEFAULT '',
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX gtt_complaints_recent ON gtt_complaints(created_at DESC);
-- Local/preview preparation only. This outbox has no email dispatcher.
CREATE TABLE gtt_complaint_outbox (
  complaint_id uuid PRIMARY KEY REFERENCES gtt_complaints(id),
  message jsonb NOT NULL,
  status text NOT NULL CHECK (status = 'preview_only'),
  created_at timestamptz NOT NULL DEFAULT now()
);
