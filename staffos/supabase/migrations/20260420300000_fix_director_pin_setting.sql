-- ============================================================
-- Fix Director PIN Setting
-- Directors log in via PIN only (no Supabase auth session).
-- The anon role cannot UPDATE user_profiles due to RLS.
-- This migration creates a SECURITY DEFINER function that
-- allows setting a PIN for any user_profiles row by ID.
-- The function is called from the API route (service role)
-- OR directly via RPC from the client as a fallback.
-- Safe to run multiple times (idempotent).
-- ============================================================

-- 1. Create a SECURITY DEFINER function to set PIN by user ID
--    This bypasses RLS and can be called by anon/authenticated roles.
--    Security: caller must provide the correct user_id (UUID).
CREATE OR REPLACE FUNCTION public.set_user_pin(p_user_id UUID, p_pin TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Validate PIN format
  IF p_pin IS NULL OR length(p_pin) != 4 OR p_pin !~ '^\d{4}$' THEN
    RAISE EXCEPTION 'PIN must be exactly 4 digits';
  END IF;

  -- Verify user exists
  IF NOT EXISTS (SELECT 1 FROM public.user_profiles WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  -- Update pin_hash
  UPDATE public.user_profiles
  SET pin_hash = p_pin, updated_at = NOW()
  WHERE id = p_user_id;

  RETURN TRUE;
END;
$$;

-- 2. Grant execute permission to anon and authenticated roles
GRANT EXECUTE ON FUNCTION public.set_user_pin(UUID, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.set_user_pin(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_user_pin(UUID, TEXT) TO service_role;

-- 3. Re-confirm the anon SELECT policy exists (idempotent)
DROP POLICY IF EXISTS "public_login_lookup_user_profiles" ON public.user_profiles;
CREATE POLICY "public_login_lookup_user_profiles"
ON public.user_profiles
FOR SELECT
TO anon
USING (true);

-- 4. Re-seed director profiles to ensure pin_hash is set correctly
DO $$
DECLARE
  v_id_1 UUID;
  v_id_2 UUID;
BEGIN

  -- ── Director 1: krrishdubeofficial@gmail.com ──────────────
  SELECT id INTO v_id_1
  FROM public.user_profiles
  WHERE email = 'krrishdubeofficial@gmail.com'
  LIMIT 1;

  IF v_id_1 IS NOT NULL THEN
    UPDATE public.user_profiles
    SET pin_hash = '6969', is_active = true, approval_status = 'approved', updated_at = NOW()
    WHERE id = v_id_1;
    RAISE NOTICE 'Director 1 PIN reset to 6969 (id: %)', v_id_1;
  ELSE
    RAISE NOTICE 'Director 1 (krrishdubeofficial@gmail.com) not found in user_profiles';
  END IF;

  -- ── Director 2: dgajconsultancyservices@gmail.com ─────────
  SELECT id INTO v_id_2
  FROM public.user_profiles
  WHERE email = 'dgajconsultancyservices@gmail.com'
  LIMIT 1;

  IF v_id_2 IS NOT NULL THEN
    UPDATE public.user_profiles
    SET pin_hash = '6969', is_active = true, approval_status = 'approved', updated_at = NOW()
    WHERE id = v_id_2;
    RAISE NOTICE 'Director 2 PIN reset to 6969 (id: %)', v_id_2;
  ELSE
    RAISE NOTICE 'Director 2 (dgajconsultancyservices@gmail.com) not found in user_profiles';
  END IF;

END $$;
