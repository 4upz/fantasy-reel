-- failed_notifications exposed recipient emails and error text to anyone.
--
-- The view was created without security_invoker, so it ran as its owner and
-- bypassed notification_log's service-role-only RLS policy. The blanket grant
-- in 20260805190000_restore_data_api_default_grants then gave anon and
-- authenticated SELECT on it, so the Data API served it with no login.
--
-- Nothing in the app, Edge Functions or Discord bot reads this view; it is an
-- ops query run from the Supabase dashboard (as postgres) or with the service
-- role. Both keep working: postgres owns the view and service_role bypasses RLS.

ALTER VIEW public.failed_notifications SET (security_invoker = true);

REVOKE ALL ON public.failed_notifications FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.failed_notifications TO service_role;
