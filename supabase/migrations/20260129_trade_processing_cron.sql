-- ============================================================================
-- Trade Processing Cron Job
--
-- Schedules automatic processing of trades that have passed review period.
-- Runs every 5 minutes to check for trades ready for execution.
-- ============================================================================

-- Schedule process-trades cron job (every 5 minutes)
SELECT cron.schedule(
  'process-trades',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/process-trades',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);
