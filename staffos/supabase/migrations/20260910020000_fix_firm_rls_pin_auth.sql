-- DGaj Connect: Fix multi-firm RLS for PIN-based (anon role) sessions
--
-- Root cause: this app's PIN login never calls supabase.auth.signIn — it's a
-- client-side session only. So every PIN-logged-in user (director, manager,
-- employee) hits Postgres as the `anon` role, with auth.uid() = NULL. The
-- previous migration wrote every new policy as `TO authenticated`, which
-- simply does not apply to anon-role requests — inserts/selects fail or
-- silently return zero rows for anyone using PIN login.
--
-- This matches the trust model the rest of this codebase already uses
-- (see the many "anon_..." policies with `USING (true)` across
-- employee_locations, director_settings, user_profiles, etc.) — role checks
-- are enforced in the app UI, not at the DB layer, because there is no
-- server-verifiable identity for PIN sessions. We follow that same pattern
-- here rather than introduce a half-broken exception for firms.

-- ── firms: allow anon (PIN-session) reads + writes, matching app-level gating ─
DROP POLICY IF EXISTS "firms_select_all_auth" ON public.firms;
DROP POLICY IF EXISTS "firms_write_directors" ON public.firms;

CREATE POLICY "firms_select_all" ON public.firms
  FOR SELECT TO public USING (true);

CREATE POLICY "firms_write_all" ON public.firms
  FOR ALL TO public USING (true) WITH CHECK (true);

-- ── firm_data_sharing: same fix ────────────────────────────────────────────
DROP POLICY IF EXISTS "firm_sharing_select" ON public.firm_data_sharing;
DROP POLICY IF EXISTS "firm_sharing_write_directors" ON public.firm_data_sharing;

CREATE POLICY "firm_sharing_select_all" ON public.firm_data_sharing
  FOR SELECT TO public USING (true);

CREATE POLICY "firm_sharing_write_all" ON public.firm_data_sharing
  FOR ALL TO public USING (true) WITH CHECK (true);

-- ── recurring_tasks / recurring_task_instances / calendar_events /
--    employee_locations / chat_channels: the firm-scoped SELECT policies
--    added in the previous migration relied on auth.uid() through
--    get_visible_firm_ids() and an auth.uid()-based role subquery — both
--    resolve to nothing for anon/PIN sessions. Revert these five to the
--    same open-read pattern the rest of the app uses. firm_id is still on
--    every row and still available for the app to filter by explicitly
--    (e.g. the Firm Switcher, once built, can add .eq('firm_id', ...) to
--    its own queries) — this migration just stops the database itself from
--    silently hiding rows from legitimate PIN-session users.

DROP POLICY IF EXISTS "rt_select_firm_scoped" ON public.recurring_tasks;
CREATE POLICY "rt_select_all" ON public.recurring_tasks
  FOR SELECT TO public USING (true);

DROP POLICY IF EXISTS "rti_select_firm_scoped" ON public.recurring_task_instances;
CREATE POLICY "rti_select_all" ON public.recurring_task_instances
  FOR SELECT TO public USING (true);

DROP POLICY IF EXISTS "calendar_events_select_firm_scoped" ON public.calendar_events;
DROP POLICY IF EXISTS "calendar_events_select_all" ON public.calendar_events; -- pre-existing name from 20260420900000
CREATE POLICY "calendar_events_select_all" ON public.calendar_events
  FOR SELECT TO public USING (true);

DROP POLICY IF EXISTS "employee_locations_select_firm_scoped" ON public.employee_locations;
CREATE POLICY "employee_locations_select_all" ON public.employee_locations
  FOR SELECT TO public USING (true);

DROP POLICY IF EXISTS "chat_channels_select_firm_scoped" ON public.chat_channels;
CREATE POLICY "chat_channels_select_all" ON public.chat_channels
  FOR SELECT TO public USING (true);

-- ── get_visible_firm_ids: also usable from anon context now ───────────────
GRANT EXECUTE ON FUNCTION public.get_visible_firm_ids(uuid, text) TO anon;

-- ─────────────────────────────────────────────────────────────────────────
-- IMPORTANT — read this:
-- This restores everything to working order, but it means firm data
-- isolation is NOT enforced by the database for PIN-session users — same as
-- almost every other table in this app today. Anyone with the anon key
-- (which ships in your browser bundle — it's public by design) can read
-- and write across firms directly via the Supabase REST API, bypassing the
-- app's UI-level role checks entirely.
--
-- This was already true of this codebase before today (director_settings,
-- employee_locations, user_profiles etc. all have similar "anon ... USING
-- (true)" policies) — multi-firm doesn't make it worse, it just doesn't fix
-- it either. If real per-firm data isolation matters for this app (likely,
-- once you have actual separate client firms), the real fix is making PIN
-- login create a genuine Supabase Auth session (e.g. a server-side endpoint
-- that verifies the PIN and returns a signed JWT via
-- supabase.auth.signInWithCustomToken or similar) so auth.uid() becomes
-- trustworthy — that's a separate, larger piece of work from this session.
-- ─────────────────────────────────────────────────────────────────────────
