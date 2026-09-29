-- DGaj Connect: Initial Schema Migration
-- Tables: user_profiles, employee_documents

-- 1. Types
DROP TYPE IF EXISTS public.user_role CASCADE;
CREATE TYPE public.user_role AS ENUM ('employee', 'manager', 'executive', 'director');

DROP TYPE IF EXISTS public.document_status CASCADE;
CREATE TYPE public.document_status AS ENUM ('pending', 'approved', 'rejected');

-- 2. Core Tables
CREATE TABLE IF NOT EXISTS public.user_profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL UNIQUE,
    full_name TEXT NOT NULL DEFAULT '',
    avatar_url TEXT DEFAULT '',
    role public.user_role DEFAULT 'employee'::public.user_role,
    department TEXT DEFAULT '',
    job_title TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    pin_hash TEXT DEFAULT '',
    has_completed_otp_login BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.employee_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
    document_name TEXT NOT NULL,
    document_type TEXT NOT NULL DEFAULT 'other',
    file_path TEXT NOT NULL,
    file_url TEXT DEFAULT '',
    file_size BIGINT DEFAULT 0,
    mime_type TEXT DEFAULT '',
    doc_status public.document_status DEFAULT 'pending'::public.document_status,
    notes TEXT DEFAULT '',
    uploaded_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 3. Indexes
CREATE INDEX IF NOT EXISTS idx_user_profiles_email ON public.user_profiles(email);
CREATE INDEX IF NOT EXISTS idx_user_profiles_role ON public.user_profiles(role);
CREATE INDEX IF NOT EXISTS idx_employee_documents_user_id ON public.employee_documents(user_id);
CREATE INDEX IF NOT EXISTS idx_employee_documents_status ON public.employee_documents(doc_status);

-- 4. Functions (BEFORE RLS policies)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    INSERT INTO public.user_profiles (id, email, full_name, avatar_url, role, department, job_title, phone)
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
        COALESCE(NEW.raw_user_meta_data->>'avatar_url', ''),
        COALESCE(NEW.raw_user_meta_data->>'role', 'employee')::public.user_role,
        COALESCE(NEW.raw_user_meta_data->>'department', ''),
        COALESCE(NEW.raw_user_meta_data->>'job_title', ''),
        COALESCE(NEW.raw_user_meta_data->>'phone', '')
    )
    ON CONFLICT (id) DO UPDATE SET
        email = EXCLUDED.email,
        full_name = COALESCE(EXCLUDED.full_name, public.user_profiles.full_name),
        avatar_url = COALESCE(EXCLUDED.avatar_url, public.user_profiles.avatar_url),
        updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$;

-- 5. Enable RLS
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_documents ENABLE ROW LEVEL SECURITY;

-- 6. RLS Policies
DROP POLICY IF EXISTS "users_manage_own_user_profiles" ON public.user_profiles;
CREATE POLICY "users_manage_own_user_profiles"
ON public.user_profiles
FOR ALL
TO authenticated
USING (id = auth.uid())
WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS "users_view_all_profiles" ON public.user_profiles;
CREATE POLICY "users_view_all_profiles"
ON public.user_profiles
FOR SELECT
TO authenticated
USING (true);

DROP POLICY IF EXISTS "users_manage_own_documents" ON public.employee_documents;
CREATE POLICY "users_manage_own_documents"
ON public.employee_documents
FOR ALL
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "users_view_all_documents" ON public.employee_documents;
CREATE POLICY "users_view_all_documents"
ON public.employee_documents
FOR SELECT
TO authenticated
USING (true);

-- 7. Triggers
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_user();

DROP TRIGGER IF EXISTS update_user_profiles_updated_at ON public.user_profiles;
CREATE TRIGGER update_user_profiles_updated_at
    BEFORE UPDATE ON public.user_profiles
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at();

DROP TRIGGER IF EXISTS update_employee_documents_updated_at ON public.employee_documents;
CREATE TRIGGER update_employee_documents_updated_at
    BEFORE UPDATE ON public.employee_documents
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at();
