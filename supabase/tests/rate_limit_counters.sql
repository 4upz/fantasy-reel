BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT no_plan();

-- Only Edge Functions (service role) may read or spend rate limits.
SELECT ok(NOT has_table_privilege(r, 'rate_limit_counters', p), r || ' has no ' || p || ' on rate_limit_counters')
FROM unnest(ARRAY['anon', 'authenticated']) AS r,
     unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) AS p;

SELECT ok(NOT has_function_privilege(r, 'consume_rate_limit(text,text,integer,integer)', 'EXECUTE'),
          r || ' cannot execute consume_rate_limit')
FROM unnest(ARRAY['anon', 'authenticated']) AS r;

SELECT ok(has_function_privilege('service_role', 'consume_rate_limit(text,text,integer,integer)', 'EXECUTE'),
          'service_role can execute consume_rate_limit');

SET LOCAL ROLE service_role;

SELECT is((SELECT allowed FROM consume_rate_limit('test', 'subject-a', 2, 3600)), true, 'first use is allowed');
SELECT is((SELECT remaining FROM consume_rate_limit('test', 'subject-a', 2, 3600)), 0, 'second use is allowed with none left');
SELECT is((SELECT allowed FROM consume_rate_limit('test', 'subject-a', 2, 3600)), false, 'third use is refused');
SELECT ok((SELECT retry_after_seconds FROM consume_rate_limit('test', 'subject-a', 2, 3600)) BETWEEN 1 AND 3600,
          'a refusal says when the window resets');
SELECT is((SELECT count FROM rate_limit_counters WHERE bucket = 'test' AND subject = 'subject-a'), 2,
          'refused uses are not counted');

SELECT is((SELECT allowed FROM consume_rate_limit('test', 'subject-b', 2, 3600)), true, 'subjects are counted separately');
SELECT is((SELECT allowed FROM consume_rate_limit('other', 'subject-a', 2, 3600)), true, 'buckets are counted separately');

-- Expired windows are swept on the next call.
INSERT INTO rate_limit_counters(bucket, subject, window_start, expires_at, count)
VALUES ('test', 'stale', now() - interval '2 days', now() - interval '1 day', 5);
SELECT is((SELECT allowed FROM consume_rate_limit('test', 'subject-c', 1, 60)), true, 'a new subject is allowed');
SELECT is((SELECT count(*)::int FROM rate_limit_counters WHERE subject = 'stale'), 0, 'expired windows are deleted');

SELECT throws_ok($$SELECT * FROM consume_rate_limit('test', 'x', 0, 60)$$, 'P0001', NULL, 'a zero max is rejected');

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
