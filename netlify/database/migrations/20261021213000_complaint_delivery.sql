ALTER TABLE gtt_complaint_outbox DROP CONSTRAINT gtt_complaint_outbox_status_check;
ALTER TABLE gtt_complaint_outbox ADD CONSTRAINT gtt_complaint_outbox_status_check
  CHECK (status IN ('preview_only','queued','processing','accepted','failed','unknown'));
ALTER TABLE gtt_complaint_outbox
  ADD COLUMN attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN lease_until timestamptz,
  ADD COLUMN provider_id text,
  ADD COLUMN error_code text,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX gtt_complaint_outbox_pending ON gtt_complaint_outbox(status,created_at);
