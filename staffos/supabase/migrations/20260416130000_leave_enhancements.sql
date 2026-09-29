-- DGaj Connect: Leave Enhancements
-- Adds: doctor_certificate_url to leave_requests, company_holidays table,
--       working_hours config in director_settings, overtime_employees table

-- 1. Add doctor certificate column to leave_requests
ALTER TABLE public.leave_requests
ADD COLUMN IF NOT EXISTS doctor_certificate_url TEXT DEFAULT '';

ALTER TABLE public.leave_requests
ADD COLUMN IF NOT EXISTS doctor_certificate_path TEXT DEFAULT '';

-- 2. Company Holidays Table
CREATE TABLE IF NOT EXISTS public.company_holidays (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    holiday_date DATE NOT NULL,
    holiday_type TEXT NOT NULL DEFAULT 'national',
    fiscal_year INTEGER NOT NULL DEFAULT EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER,
    is_sunday_overtime BOOLEAN DEFAULT false,
    notes TEXT DEFAULT '',
    created_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_company_holidays_date ON public.company_holidays(holiday_date);
CREATE INDEX IF NOT EXISTS idx_company_holidays_fiscal_year ON public.company_holidays(fiscal_year);
CREATE INDEX IF NOT EXISTS idx_company_holidays_type ON public.company_holidays(holiday_type);

-- 3. Sunday Overtime Employees Table
CREATE TABLE IF NOT EXISTS public.sunday_overtime_employees (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
    fiscal_year INTEGER NOT NULL DEFAULT EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER,
    is_active BOOLEAN DEFAULT true,
    notes TEXT DEFAULT '',
    created_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sunday_overtime_user_year ON public.sunday_overtime_employees(user_id, fiscal_year);
CREATE INDEX IF NOT EXISTS idx_sunday_overtime_fiscal_year ON public.sunday_overtime_employees(fiscal_year);

-- 4. Enable RLS
ALTER TABLE public.company_holidays ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sunday_overtime_employees ENABLE ROW LEVEL SECURITY;

-- 5. RLS Policies for company_holidays
DROP POLICY IF EXISTS "all_users_view_holidays" ON public.company_holidays;
CREATE POLICY "all_users_view_holidays"
ON public.company_holidays
FOR SELECT
TO authenticated
USING (true);

DROP POLICY IF EXISTS "managers_manage_holidays" ON public.company_holidays;
CREATE POLICY "managers_manage_holidays"
ON public.company_holidays
FOR ALL
TO authenticated
USING (public.is_director_or_manager())
WITH CHECK (public.is_director_or_manager());

-- 6. RLS Policies for sunday_overtime_employees
DROP POLICY IF EXISTS "all_users_view_overtime_employees" ON public.sunday_overtime_employees;
CREATE POLICY "all_users_view_overtime_employees"
ON public.sunday_overtime_employees
FOR SELECT
TO authenticated
USING (true);

DROP POLICY IF EXISTS "managers_manage_overtime_employees" ON public.sunday_overtime_employees;
CREATE POLICY "managers_manage_overtime_employees"
ON public.sunday_overtime_employees
FOR ALL
TO authenticated
USING (public.is_director_or_manager())
WITH CHECK (public.is_director_or_manager());

-- 7. Storage bucket for leave certificates (if not exists)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'leave-certificates',
    'leave-certificates',
    false,
    10485760,
    ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
ON CONFLICT (id) DO NOTHING;

-- 8. Storage RLS for leave-certificates
DROP POLICY IF EXISTS "users_upload_leave_certificates" ON storage.objects;
CREATE POLICY "users_upload_leave_certificates"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
    bucket_id = 'leave-certificates' AND
    (storage.foldername(name))[1] = auth.uid()::text
);

DROP POLICY IF EXISTS "users_view_own_leave_certificates" ON storage.objects;
CREATE POLICY "users_view_own_leave_certificates"
ON storage.objects
FOR SELECT
TO authenticated
USING (
    bucket_id = 'leave-certificates' AND
    (
        (storage.foldername(name))[1] = auth.uid()::text
        OR public.is_director_or_manager()
    )
);

DROP POLICY IF EXISTS "users_delete_own_leave_certificates" ON storage.objects;
CREATE POLICY "users_delete_own_leave_certificates"
ON storage.objects
FOR DELETE
TO authenticated
USING (
    bucket_id = 'leave-certificates' AND
    (storage.foldername(name))[1] = auth.uid()::text
);

-- 9. Seed default working_hours and financial_year settings in director_settings
INSERT INTO public.director_settings (setting_key, setting_value)
VALUES (
    'working_hours',
    jsonb_build_object(
        'standard_start', '09:00',
        'standard_end', '18:00',
        'break_minutes', 60,
        'weekly_hours', 40,
        'daily_hours', 8,
        'overtime_threshold_daily', 2,
        'overtime_threshold_weekly', 10,
        'overtime_threshold_monthly', 40
    )
)
ON CONFLICT (setting_key) DO NOTHING;

INSERT INTO public.director_settings (setting_key, setting_value)
VALUES (
    'financial_year',
    jsonb_build_object(
        'start_month', 4,
        'start_day', 1,
        'current_fy_start', '2026-04-01',
        'current_fy_end', '2027-03-31'
    )
)
ON CONFLICT (setting_key) DO NOTHING;

INSERT INTO public.director_settings (setting_key, setting_value)
VALUES (
    'leave_quotas_by_fy',
    jsonb_build_object(
        'employee', jsonb_build_object('casual', 12, 'sick', 8, 'paid', 15, 'comp_off', 2, 'work_from_home', 8, 'maternity', 90, 'paternity', 15, 'unpaid', 0),
        'manager', jsonb_build_object('casual', 15, 'sick', 10, 'paid', 18, 'comp_off', 3, 'work_from_home', 10, 'maternity', 90, 'paternity', 15, 'unpaid', 0),
        'executive', jsonb_build_object('casual', 18, 'sick', 12, 'paid', 20, 'comp_off', 4, 'work_from_home', 12, 'maternity', 90, 'paternity', 15, 'unpaid', 0),
        'director', jsonb_build_object('casual', 20, 'sick', 15, 'paid', 25, 'comp_off', 5, 'work_from_home', 15, 'maternity', 90, 'paternity', 15, 'unpaid', 0)
    )
)
ON CONFLICT (setting_key) DO NOTHING;

-- 10. Triggers
DROP TRIGGER IF EXISTS update_company_holidays_updated_at ON public.company_holidays;
CREATE TRIGGER update_company_holidays_updated_at
    BEFORE UPDATE ON public.company_holidays
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at();

DROP TRIGGER IF EXISTS update_sunday_overtime_updated_at ON public.sunday_overtime_employees;
CREATE TRIGGER update_sunday_overtime_updated_at
    BEFORE UPDATE ON public.sunday_overtime_employees
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at();
