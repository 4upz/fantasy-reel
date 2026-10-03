BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT no_plan();

-- respond_to_trade() and veto_trade() trust their caller; only the
-- respond-trade and veto-trade Edge Functions (service role) may call them.
SELECT ok(NOT has_function_privilege(r, f, 'EXECUTE'), r || ' cannot execute ' || f)
FROM unnest(ARRAY['anon', 'authenticated']) AS r,
  unnest(ARRAY['respond_to_trade(uuid,text,text)', 'veto_trade(uuid,text)']) AS f;

SELECT ok(has_function_privilege('service_role', f, 'EXECUTE'), 'service_role can execute ' || f)
FROM unnest(ARRAY['respond_to_trade(uuid,text,text)', 'veto_trade(uuid,text)']) AS f;

SELECT * FROM finish();
ROLLBACK;
