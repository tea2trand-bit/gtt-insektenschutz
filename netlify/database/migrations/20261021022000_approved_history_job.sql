CREATE TABLE gtt_admin_import_jobs (
  id text PRIMARY KEY,
  source_sha256 text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now(),
  receipt jsonb NOT NULL
);
