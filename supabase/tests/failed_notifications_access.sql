BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT no_plan();

-- failed_notifications holds recipient emails: only the service role reads it.

SELECT ok(
  NOT has_table_privilege('anon', 'public.failed_notifications', 'SELECT'),
  'anon cannot read failed_notifications'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.failed_notifications', 'SELECT'),
  'authenticated cannot read failed_notifications'
);
SELECT ok(
  has_table_privilege('service_role', 'public.failed_notifications', 'SELECT'),
  'service_role can read failed_notifications'
);
SELECT ok(
  (SELECT 'security_invoker=true' = ANY(reloptions) FROM pg_class
    WHERE oid = 'public.failed_notifications'::regclass),
  'failed_notifications runs with the caller''s privileges'
);

SELECT * FROM finish();
ROLLBACK;
