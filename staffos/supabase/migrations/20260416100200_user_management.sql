-- DGaj Connect: User Management & Employee Profiles Extension
-- Adds: user_access_requests table, extended profile fields, role-based RLS

-- 1. Add extended profile columns to user_profiles
ALTER TABLE public.user_profiles
ADD COLUMN IF NOT EXISTS employee_id TEXT DEFAULT '',
ADD COLUMN IF NOT EXISTS date_of_birth DATE,
ADD COLUMN IF NOT EXISTS date_of_joining DATE,
ADD COLUMN IF NOT EXISTS address TEXT DEFAULT '',
ADD COLUMN IF NOT EXISTS emergency_contact_name TEXT DEFAULT '',
ADD COLUMN IF NOT EXISTS emergency_contact_phone TEXT DEFAULT '',
ADD COLUMN IF NOT EXISTS blood_group TEXT DEFAULT '',
ADD COLUMN IF NOT EXISTS nationality TEXT DEFAULT '',
ADD COLUMN IF NOT EXISTS profile_photo_url TEXT DEFAULT '',
ADD COLUMN IF NOT EXISTS bio TEXT DEFAULT '',
ADD COLUMN IF NOT EXISTS skills TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN IF NOT EXISTS manager_id UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS approval_status TEXT DEFAULT 'pending';

-- 2. Access Requests Table
CREATE TABLE IF NOT EXISTS public.user_access_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    requester_email TEXT NOT NULL,
    requester_name TEXT NOT NULL DEFAULT '',
    requested_role TEXT NOT NULL DEFAULT 'employee',
    department TEXT DEFAULT '',
    job_title TEXT DEFAULT '',
    message TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',
    reviewed_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ,
    rejection_reason TEXT DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 3. Indexes
CREATE INDEX IF NOT EXISTS idx_user_access_requests_status ON public.user_access_requests(status);
CREATE INDEX IF NOT EXISTS idx_user_access_requests_email ON public.user_access_requests(requester_email);
CREATE INDEX IF NOT EXISTS idx_user_profiles_manager_id ON public.user_profiles(manager_id);
CREATE INDEX IF NOT EXISTS idx_user_profiles_approval_status ON public.user_profiles(approval_status);

-- 4. Helper functions for role-based access (BEFORE RLS policies)
CREATE OR REPLACE FUNCTION public.is_director_or_manager()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
SELECT EXISTS (
    SELECT 1 FROM public.user_profiles up
    WHERE up.id = auth.uid() AND up.role IN ('director', 'manager')
)
$$;

CREATE OR REPLACE FUNCTION public.is_director()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
SELECT EXISTS (
    SELECT 1 FROM public.user_profiles up
    WHERE up.id = auth.uid() AND up.role = 'director'
)
$$;

-- 5. Enable RLS on new table
ALTER TABLE public.user_access_requests ENABLE ROW LEVEL SECURITY;

-- 6. RLS Policies for user_access_requests
DROP POLICY IF EXISTS "anyone_can_create_access_request" ON public.user_access_requests;
CREATE POLICY "anyone_can_create_access_request"
ON public.user_access_requests
FOR INSERT
TO authenticated
WITH CHECK (true);

DROP POLICY IF EXISTS "directors_managers_view_requests" ON public.user_access_requests;
CREATE POLICY "directors_managers_view_requests"
ON public.user_access_requests
FOR SELECT
TO authenticated
USING (public.is_director_or_manager());

DROP POLICY IF EXISTS "directors_managers_update_requests" ON public.user_access_requests;
CREATE POLICY "directors_managers_update_requests"
ON public.user_access_requests
FOR UPDATE
TO authenticated
USING (public.is_director_or_manager())
WITH CHECK (public.is_director_or_manager());

-- 7. Extended RLS for user_profiles: directors/managers can update any profile
DROP POLICY IF EXISTS "directors_managers_update_profiles" ON public.user_profiles;
CREATE POLICY "directors_managers_update_profiles"
ON public.user_profiles
FOR UPDATE
TO authenticated
USING (public.is_director_or_manager())
WITH CHECK (public.is_director_or_manager());

-- 8. Trigger for updated_at on access requests
DROP TRIGGER IF EXISTS update_user_access_requests_updated_at ON public.user_access_requests;
CREATE TRIGGER update_user_access_requests_updated_at
    BEFORE UPDATE ON public.user_access_requests
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at();
