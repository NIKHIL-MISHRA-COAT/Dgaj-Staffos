-- DGaj Connect: Multi-device session tracking
--
-- Lets a director see that the same employee is logged in on more than one
-- device at once (e.g. phone + laptop) as two separate entries, instead of
-- one row per user_id. Additive migration, safe on the live DB.

CREATE TABLE IF NOT EXISTS public.user_device_sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  device_id     text NOT NULL,          -- random UUID persisted in that browser's localStorage
  device_label  text,                   -- e.g. "Chrome on Windows", "Safari on iPhone"
  platform      text,                   -- 'mobile' | 'desktop' | 'tablet'
  firm_id       uuid REFERENCES public.firms(id) ON DELETE SET NULL,
  first_seen    timestamptz NOT NULL DEFAULT now(),
  last_seen     timestamptz NOT NULL DEFAULT now(),
  is_active     boolean NOT NULL DEFAULT true,
  UNIQUE (user_id, device_id)
);

CREATE INDEX IF NOT EXISTS idx_device_sessions_user ON public.user_device_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_device_sessions_last_seen ON public.user_device_sessions(last_seen);

ALTER TABLE public.user_device_sessions ENABLE ROW LEVEL SECURITY;

-- Same trust model as the rest of this app's PIN-session tables (see
-- 20260910020000_fix_firm_rls_pin_auth.sql) — PIN logins carry no JWT, so
-- role checks happen in the app UI, not via auth.uid() here.
DROP POLICY IF EXISTS "device_sessions_select_all" ON public.user_device_sessions;
CREATE POLICY "device_sessions_select_all" ON public.user_device_sessions
  FOR SELECT TO public USING (true);

DROP POLICY IF EXISTS "device_sessions_write_all" ON public.user_device_sessions;
CREATE POLICY "device_sessions_write_all" ON public.user_device_sessions
  FOR ALL TO public USING (true) WITH CHECK (true);

-- A session with no heartbeat in 10+ minutes is considered stale/logged-out.
-- Called periodically (e.g. from the same place mark_overdue_recurring_instances
-- gets called) rather than on a cron, to avoid needing pg_cron setup.
CREATE OR REPLACE FUNCTION public.mark_stale_device_sessions()
RETURNS void
LANGUAGE sql
AS $$
  UPDATE public.user_device_sessions
  SET is_active = false
  WHERE is_active = true AND last_seen < now() - interval '10 minutes';
$$;

GRANT EXECUTE ON FUNCTION public.mark_stale_device_sessions() TO anon, authenticated;

-- Add to realtime so the director's device list updates live.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'user_device_sessions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.user_device_sessions;
  END IF;
END $$;
