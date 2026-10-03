-- notification_log leaked other members' email addresses.
--
-- Two SELECT policies from 20260201_add_notification_log let a trade's
-- participants, and the owner of its league, read every row logged for that
-- trade. Each row carries recipient_email, so the other side of a trade (or
-- the commissioner, for every member who ever got a trade email) could read
-- addresses the rest of the app keeps hidden.
--
-- Nothing in the frontend, Edge Functions or Discord bot reads this table with
-- a user's client. Writes go through the service-role-only
-- log_notification_delivery RPC, and failures are read from the
-- failed_notifications view by the service role or from the dashboard. So the
-- table becomes service-role only, like that view
-- (20261003150600_restrict_failed_notifications).

DROP POLICY IF EXISTS "Trade participants can view trade notifications" ON public.notification_log;
DROP POLICY IF EXISTS "League owners can view league notifications" ON public.notification_log;
-- Unused by any client, and moot once the grant below is gone.
DROP POLICY IF EXISTS "Users can view their own notifications" ON public.notification_log;

REVOKE ALL ON public.notification_log FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notification_log TO service_role;
