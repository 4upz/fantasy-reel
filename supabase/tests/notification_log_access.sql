BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT no_plan();

-- notification_log holds recipient emails: only the service role reads it.

SELECT ok(
  NOT has_table_privilege('anon', 'public.notification_log', 'SELECT'),
  'anon cannot read notification_log'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.notification_log', 'SELECT'),
  'authenticated cannot read notification_log'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.notification_log', 'INSERT'),
  'authenticated cannot write notification_log'
);
SELECT ok(
  has_table_privilege('service_role', 'public.notification_log', 'SELECT'),
  'service_role can read notification_log'
);
SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'notification_log'
      AND (roles && ARRAY['authenticated', 'anon', 'public']::name[])
      AND policyname <> 'Service role can manage notification log'),
  0,
  'no user-facing policies remain on notification_log'
);

-- A trade participant querying the table gets a permission error, not rows.
INSERT INTO auth.users (id, email)
VALUES ('d1d1d1d1-0000-4000-8000-000000000001', 'd1-leak@private.test');
INSERT INTO notification_log (notification_type, recipient_email, recipient_user_id, status)
VALUES ('trade_proposed', 'd1-leak@private.test', 'd1d1d1d1-0000-4000-8000-000000000001', 'sent');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"d1d1d1d1-0000-4000-8000-000000000002","role":"authenticated"}', true);
SELECT throws_ok(
  'SELECT recipient_email FROM public.notification_log',
  '42501',
  NULL,
  'a signed-in user cannot select from notification_log'
);
RESET ROLE;

-- The service-role write path still works.
SET LOCAL ROLE service_role;
SELECT lives_ok(
  $$SELECT log_notification_delivery(NULL, 'test_type', 'ops@private.test', NULL, 'sent'::notification_delivery_status)$$,
  'service_role can still log a delivery'
);
SELECT ok(
  (SELECT count(*) FROM public.notification_log WHERE recipient_email = 'ops@private.test') = 1,
  'service_role can read the logged row'
);
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
