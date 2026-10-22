-- Preserve the issued invoice and PDF; append its immutable cancellation.
ALTER TABLE gtt_invoices ADD COLUMN cancellation jsonb;
ALTER TABLE gtt_invoices ADD COLUMN cancellation_pdf bytea;
