ALTER TABLE gtt_team_outbox DROP CONSTRAINT gtt_team_outbox_kind_check;
ALTER TABLE gtt_team_outbox ADD CONSTRAINT gtt_team_outbox_kind_check
  CHECK (kind IN ('new_inquiry','customer_acceptance','customer_decline'));
