-- ============================================================
-- Fix PIN Setting & Clock-In Auth
-- 1. Ensure anon SELECT policy exists for login lookup
-- 2. Ensure set_user_pin SECURITY DEFINER function exists
-- 3. Add service_role UPDATE policy so admin client can set PINs
-- 4. Re-seed director PINs to 6969
-- Safe to run multiple times (idempotent).
-- ============================================================

-- 1. Ensure anon SELECT policy for login (PIN login lookup)
DROP POLICY IF EXISTS "public_login_lookup_user_profiles" ON public.user_profiles;
CREATE POLICY "public_login_lookup_user_profiles"
ON public.user_profiles
FOR SELECT
TO anon
USING (true);

-- 2. Allow service_role to UPDATE user_profiles (for PIN setting via admin client)
DROP POLICY IF EXISTS "service_role_update_user_profiles" ON public.user_profiles;
CREATE POLICY "service_role_update_user_profiles"
ON public.user_profiles
FOR UPDATE
TO service_role
USING (true)
WITH CHECK (true);

-- 3. Allow authenticated users to UPDATE their own profile
DROP POLICY IF EXISTS "users_update_own_profile" ON public.user_profiles;
CREATE POLICY "users_update_own_profile"
ON public.user_profiles
FOR UPDATE
TO authenticated
USING (auth.uid() = id)
WITH CHECK (auth.uid() = id);

-- 4. SECURITY DEFINER function to set PIN (fallback when service role key not configured)
CREATE OR REPLACE FUNCTION public.set_user_pin(p_user_id UUID, p_pin TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_pin IS NULL OR length(p_pin) != 4 OR p_pin !~ '^\d{4}$' THEN
    RAISE EXCEPTION 'PIN must be exactly 4 digits';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.user_profiles WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  UPDATE public.user_profiles
  SET pin_hash = p_pin, updated_at = NOW()
  WHERE id = p_user_id;

  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_user_pin(UUID, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.set_user_pin(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_user_pin(UUID, TEXT) TO service_role;

-- 5. Re-seed director PINs to 6969
DO $$
DECLARE
  v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.user_profiles WHERE email = 'krrishdubeofficial@gmail.com' LIMIT 1;
  IF v_id IS NOT NULL THEN
    UPDATE public.user_profiles SET pin_hash = '6969', is_active = true, approval_status = 'approved', updated_at = NOW() WHERE id = v_id;
    RAISE NOTICE 'Director 1 PIN reset to 6969';
  END IF;

  SELECT id INTO v_id FROM public.user_profiles WHERE email = 'dgajconsultancyservices@gmail.com' LIMIT 1;
  IF v_id IS NOT NULL THEN
    UPDATE public.user_profiles SET pin_hash = '6969', is_active = true, approval_status = 'approved', updated_at = NOW() WHERE id = v_id;
    RAISE NOTICE 'Director 2 PIN reset to 6969';
  END IF;
END $$;
