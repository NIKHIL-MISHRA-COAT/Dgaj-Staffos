-- ============================================================
-- Fix Director Login & PIN-Session User Management
-- Directors log in via PIN only (no Supabase auth session).
-- The login form queries user_profiles by email to verify PIN.
-- Without a public SELECT policy, RLS blocks this query.
-- This migration adds the necessary policies.
-- Safe to run multiple times (idempotent).
-- ============================================================

-- 1. Allow public (anon) SELECT on user_profiles so the PIN login
--    form can look up a user by email without a Supabase auth session.
--    Only email, role, department, full_name, pin_hash, approval_status
--    are needed — but RLS is row-level, not column-level, so we allow
--    SELECT on the whole table for the anon role.
DROP POLICY IF EXISTS "public_login_lookup_user_profiles" ON public.user_profiles;
CREATE POLICY "public_login_lookup_user_profiles"
ON public.user_profiles
FOR SELECT
TO anon
USING (true);

-- 2. Allow service_role full access (used by Edge Functions with service role key).
--    This is usually implicit but we make it explicit for clarity.
DROP POLICY IF EXISTS "service_role_full_access_user_profiles" ON public.user_profiles;
CREATE POLICY "service_role_full_access_user_profiles"
ON public.user_profiles
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- 3. Ensure the existing authenticated SELECT policy still exists
--    (re-create idempotently in case it was dropped).
DROP POLICY IF EXISTS "users_view_all_profiles" ON public.user_profiles;
CREATE POLICY "users_view_all_profiles"
ON public.user_profiles
FOR SELECT
TO authenticated
USING (true);

-- 4. Ensure the existing authenticated manage-own policy still exists.
DROP POLICY IF EXISTS "users_manage_own_user_profiles" ON public.user_profiles;
CREATE POLICY "users_manage_own_user_profiles"
ON public.user_profiles
FOR ALL
TO authenticated
USING (id = auth.uid())
WITH CHECK (id = auth.uid());

-- 5. Re-seed director profiles to ensure they are present and correct.
--    This is idempotent — safe to run multiple times.
DO $$
DECLARE
  v_id_1 UUID;
  v_id_2 UUID;
BEGIN

  -- ── Director 1: krrishdubeofficial@gmail.com ──────────────
  SELECT id INTO v_id_1
  FROM auth.users
  WHERE email = 'krrishdubeofficial@gmail.com'
  LIMIT 1;

  IF v_id_1 IS NULL THEN
    v_id_1 := gen_random_uuid();
    INSERT INTO auth.users (
      id, instance_id, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at, role, aud,
      is_sso_user, is_anonymous, confirmation_token, recovery_token,
      email_change_token_new, email_change, email_change_token_current,
      email_change_confirm_status, reauthentication_token, phone, phone_change,
      phone_change_token
    ) VALUES (
      v_id_1, '00000000-0000-0000-0000-000000000000',
      'krrishdubeofficial@gmail.com', '', NOW(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"full_name":"Krrish Dube","role":"director"}'::jsonb,
      NOW(), NOW(), 'authenticated', 'authenticated',
      false, false, '', '', '', '', '', 0, '', null, '', ''
    );
  END IF;

  INSERT INTO public.user_profiles (
    id, email, full_name, role, pin_hash, is_active, approval_status, created_at, updated_at
  ) VALUES (
    v_id_1, 'krrishdubeofficial@gmail.com', 'Krrish Dube',
    'director', '6969', true, 'approved', NOW(), NOW()
  )
  ON CONFLICT (id) DO UPDATE SET
    email           = EXCLUDED.email,
    full_name       = EXCLUDED.full_name,
    role            = EXCLUDED.role,
    pin_hash        = EXCLUDED.pin_hash,
    is_active       = EXCLUDED.is_active,
    approval_status = EXCLUDED.approval_status,
    updated_at      = NOW();

  RAISE NOTICE 'Director 1 (krrishdubeofficial@gmail.com) seeded with id: %', v_id_1;

  -- ── Director 2: dgajconsultancyservices@gmail.com ─────────
  SELECT id INTO v_id_2
  FROM auth.users
  WHERE email = 'dgajconsultancyservices@gmail.com'
  LIMIT 1;

  IF v_id_2 IS NULL THEN
    v_id_2 := gen_random_uuid();
    INSERT INTO auth.users (
      id, instance_id, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at, role, aud,
      is_sso_user, is_anonymous, confirmation_token, recovery_token,
      email_change_token_new, email_change, email_change_token_current,
      email_change_confirm_status, reauthentication_token, phone, phone_change,
      phone_change_token
    ) VALUES (
      v_id_2, '00000000-0000-0000-0000-000000000000',
      'dgajconsultancyservices@gmail.com', '', NOW(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"full_name":"DGaj Consultancy Services","role":"director"}'::jsonb,
      NOW(), NOW(), 'authenticated', 'authenticated',
      false, false, '', '', '', '', '', 0, '', null, '', ''
    );
  END IF;

  INSERT INTO public.user_profiles (
    id, email, full_name, role, pin_hash, is_active, approval_status, created_at, updated_at
  ) VALUES (
    v_id_2, 'dgajconsultancyservices@gmail.com', 'DGaj Consultancy Services',
    'director', '6969', true, 'approved', NOW(), NOW()
  )
  ON CONFLICT (id) DO UPDATE SET
    email           = EXCLUDED.email,
    full_name       = EXCLUDED.full_name,
    role            = EXCLUDED.role,
    pin_hash        = EXCLUDED.pin_hash,
    is_active       = EXCLUDED.is_active,
    approval_status = EXCLUDED.approval_status,
    updated_at      = NOW();

  RAISE NOTICE 'Director 2 (dgajconsultancyservices@gmail.com) seeded with id: %', v_id_2;

END $$;
