BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT plan(3);

-- Clients must not be able to ask whether an email has an account.
SELECT hasnt_function('public', 'count_users_by_email', ARRAY['text'],
  'count_users_by_email is gone');

SELECT ok(NOT has_function_privilege('authenticated', 'public.get_original_user_id(text,uuid)', 'EXECUTE'),
  'authenticated cannot execute get_original_user_id');
SELECT ok(NOT has_function_privilege('anon', 'public.get_original_user_id(text,uuid)', 'EXECUTE'),
  'anon cannot execute get_original_user_id');

SELECT * FROM finish();
ROLLBACK;
