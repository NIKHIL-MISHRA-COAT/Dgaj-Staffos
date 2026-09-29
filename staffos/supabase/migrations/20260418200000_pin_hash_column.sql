-- Migration: Ensure pin_hash and email columns exist on user_profiles for PIN-based login
-- Director sets pin_hash via User Management; employees log in with email + PIN only

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS pin_hash TEXT DEFAULT NULL;

-- Ensure email column exists (may already exist from initial schema)
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS email TEXT DEFAULT '';

-- Index for fast email lookup at login
CREATE INDEX IF NOT EXISTS idx_user_profiles_email ON public.user_profiles(email);

-- Allow users to read their own profile by email (for PIN login lookup)
-- This policy allows the login screen to look up a profile by email without auth
DROP POLICY IF EXISTS "Allow email lookup for login" ON public.user_profiles;
CREATE POLICY "Allow email lookup for login"
  ON public.user_profiles FOR SELECT
  TO anon, authenticated
  USING (true);
