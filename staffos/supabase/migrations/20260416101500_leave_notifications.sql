-- DGaj Connect: Leave Management & Real-Time Notifications
-- Tables: leave_requests, notifications

-- 1. Types
DROP TYPE IF EXISTS public.leave_type CASCADE;
CREATE TYPE public.leave_type AS ENUM ('casual', 'sick', 'paid', 'comp_off', 'work_from_home', 'maternity', 'paternity', 'unpaid');

DROP TYPE IF EXISTS public.leave_status CASCADE;
CREATE TYPE public.leave_status AS ENUM ('pending', 'approved', 'rejected', 'cancelled');

DROP TYPE IF EXISTS public.notification_type CASCADE;
CREATE TYPE public.notification_type AS ENUM ('leave_applied', 'leave_approved', 'leave_rejected', 'leave_cancelled', 'task_assigned', 'task_updated', 'user_approved', 'general');

-- 2. Leave Requests Table
CREATE TABLE IF NOT EXISTS public.leave_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
    leave_type public.leave_type NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    total_days INTEGER NOT NULL DEFAULT 1,
    reason TEXT NOT NULL DEFAULT '',
    status public.leave_status DEFAULT 'pending'::public.leave_status,
    reviewed_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ,
    rejection_reason TEXT DEFAULT '',
    is_half_day BOOLEAN DEFAULT false,
    half_day_period TEXT DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 3. Leave Balances Table
CREATE TABLE IF NOT EXISTS public.leave_balances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
    leave_type public.leave_type NOT NULL,
    total_days INTEGER NOT NULL DEFAULT 0,
    used_days INTEGER NOT NULL DEFAULT 0,
    fiscal_year INTEGER NOT NULL DEFAULT EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_leave_balances_unique ON public.leave_balances(user_id, leave_type, fiscal_year);

-- 4. Notifications Table
CREATE TABLE IF NOT EXISTS public.notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
    type public.notification_type NOT NULL DEFAULT 'general'::public.notification_type,
    title TEXT NOT NULL,
    message TEXT NOT NULL DEFAULT '',
    is_read BOOLEAN DEFAULT false,
    related_id UUID,
    related_type TEXT DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 5. Indexes
CREATE INDEX IF NOT EXISTS idx_leave_requests_user_id ON public.leave_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_leave_requests_status ON public.leave_requests(status);
CREATE INDEX IF NOT EXISTS idx_leave_requests_dates ON public.leave_requests(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_leave_balances_user_id ON public.leave_balances(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON public.notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON public.notifications(is_read);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON public.notifications(created_at DESC);

-- 6. Functions (BEFORE RLS policies)
CREATE OR REPLACE FUNCTION public.notify_leave_reviewer()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $func$
DECLARE
    applicant_name TEXT;
    reviewer_id UUID;
    leave_label TEXT;
BEGIN
    SELECT full_name INTO applicant_name FROM public.user_profiles WHERE id = NEW.user_id;
    SELECT manager_id INTO reviewer_id FROM public.user_profiles WHERE id = NEW.user_id;
    
    leave_label := CASE NEW.leave_type
        WHEN 'casual' THEN 'Casual Leave'
        WHEN 'sick' THEN 'Sick Leave'
        WHEN 'paid' THEN 'Paid Leave'
        WHEN 'comp_off' THEN 'Comp-Off'
        WHEN 'work_from_home' THEN 'Work From Home'
        WHEN 'maternity' THEN 'Maternity Leave'
        WHEN 'paternity' THEN 'Paternity Leave'
        WHEN 'unpaid' THEN 'Unpaid Leave'
        ELSE 'Leave'
    END;

    IF TG_OP = 'INSERT' AND reviewer_id IS NOT NULL THEN
        INSERT INTO public.notifications (user_id, type, title, message, related_id, related_type)
        VALUES (
            reviewer_id,
            'leave_applied'::public.notification_type,
            'New Leave Request',
            applicant_name || ' applied for ' || leave_label || ' (' || NEW.total_days || ' day(s))',
            NEW.id,
            'leave_request'
        );
    END IF;

    IF TG_OP = 'UPDATE' AND OLD.status != NEW.status THEN
        IF NEW.status = 'approved' THEN
            INSERT INTO public.notifications (user_id, type, title, message, related_id, related_type)
            VALUES (
                NEW.user_id,
                'leave_approved'::public.notification_type,
                'Leave Approved',
                'Your ' || leave_label || ' request has been approved',
                NEW.id,
                'leave_request'
            );
        ELSIF NEW.status = 'rejected' THEN
            INSERT INTO public.notifications (user_id, type, title, message, related_id, related_type)
            VALUES (
                NEW.user_id,
                'leave_rejected'::public.notification_type,
                'Leave Rejected',
                'Your ' || leave_label || ' request was rejected' || CASE WHEN NEW.rejection_reason != '' THEN ': ' || NEW.rejection_reason ELSE '' END,
                NEW.id,
                'leave_request'
            );
        END IF;
    END IF;

    RETURN NEW;
END;
$func$;

CREATE OR REPLACE FUNCTION public.update_leave_balance_on_approval()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $func$
DECLARE
    fy INTEGER;
BEGIN
    fy := EXTRACT(YEAR FROM NEW.start_date)::INTEGER;

    IF TG_OP = 'UPDATE' AND OLD.status != NEW.status THEN
        IF NEW.status = 'approved' AND OLD.status = 'pending' THEN
            INSERT INTO public.leave_balances (user_id, leave_type, total_days, used_days, fiscal_year)
            VALUES (NEW.user_id, NEW.leave_type, 0, NEW.total_days, fy)
            ON CONFLICT (user_id, leave_type, fiscal_year)
            DO UPDATE SET used_days = public.leave_balances.used_days + NEW.total_days,
                          updated_at = CURRENT_TIMESTAMP;
        ELSIF OLD.status = 'approved' AND NEW.status = 'cancelled' THEN
            UPDATE public.leave_balances
            SET used_days = GREATEST(0, used_days - NEW.total_days),
                updated_at = CURRENT_TIMESTAMP
            WHERE user_id = NEW.user_id AND leave_type = NEW.leave_type AND fiscal_year = fy;
        END IF;
    END IF;

    RETURN NEW;
END;
$func$;

-- 7. Enable RLS
ALTER TABLE public.leave_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leave_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- 8. RLS Policies for leave_requests
DROP POLICY IF EXISTS "employees_manage_own_leave_requests" ON public.leave_requests;
CREATE POLICY "employees_manage_own_leave_requests"
ON public.leave_requests
FOR ALL
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "managers_view_team_leave_requests" ON public.leave_requests;
CREATE POLICY "managers_view_team_leave_requests"
ON public.leave_requests
FOR SELECT
TO authenticated
USING (public.is_director_or_manager());

DROP POLICY IF EXISTS "managers_update_leave_requests" ON public.leave_requests;
CREATE POLICY "managers_update_leave_requests"
ON public.leave_requests
FOR UPDATE
TO authenticated
USING (public.is_director_or_manager())
WITH CHECK (public.is_director_or_manager());

-- 9. RLS Policies for leave_balances
DROP POLICY IF EXISTS "users_view_own_leave_balances" ON public.leave_balances;
CREATE POLICY "users_view_own_leave_balances"
ON public.leave_balances
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

DROP POLICY IF EXISTS "managers_view_all_leave_balances" ON public.leave_balances;
CREATE POLICY "managers_view_all_leave_balances"
ON public.leave_balances
FOR SELECT
TO authenticated
USING (public.is_director_or_manager());

DROP POLICY IF EXISTS "system_manage_leave_balances" ON public.leave_balances;
CREATE POLICY "system_manage_leave_balances"
ON public.leave_balances
FOR ALL
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

-- 10. RLS Policies for notifications
DROP POLICY IF EXISTS "users_manage_own_notifications" ON public.notifications;
CREATE POLICY "users_manage_own_notifications"
ON public.notifications
FOR ALL
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

-- 11. Triggers
DROP TRIGGER IF EXISTS on_leave_request_change ON public.leave_requests;
CREATE TRIGGER on_leave_request_change
    AFTER INSERT OR UPDATE ON public.leave_requests
    FOR EACH ROW
    EXECUTE FUNCTION public.notify_leave_reviewer();

DROP TRIGGER IF EXISTS on_leave_approval_balance ON public.leave_requests;
CREATE TRIGGER on_leave_approval_balance
    AFTER UPDATE ON public.leave_requests
    FOR EACH ROW
    EXECUTE FUNCTION public.update_leave_balance_on_approval();

DROP TRIGGER IF EXISTS update_leave_requests_updated_at ON public.leave_requests;
CREATE TRIGGER update_leave_requests_updated_at
    BEFORE UPDATE ON public.leave_requests
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at();

DROP TRIGGER IF EXISTS update_leave_balances_updated_at ON public.leave_balances;
CREATE TRIGGER update_leave_balances_updated_at
    BEFORE UPDATE ON public.leave_balances
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at();

-- 12. Seed default leave balances for existing users
DO $$
DECLARE
    rec RECORD;
    fy INTEGER := EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER;
BEGIN
    FOR rec IN SELECT id FROM public.user_profiles LOOP
        INSERT INTO public.leave_balances (user_id, leave_type, total_days, used_days, fiscal_year)
        VALUES
            (rec.id, 'casual'::public.leave_type, 12, 0, fy),
            (rec.id, 'sick'::public.leave_type, 8, 0, fy),
            (rec.id, 'paid'::public.leave_type, 15, 0, fy),
            (rec.id, 'comp_off'::public.leave_type, 2, 0, fy),
            (rec.id, 'work_from_home'::public.leave_type, 8, 0, fy)
        ON CONFLICT (user_id, leave_type, fiscal_year) DO NOTHING;
    END LOOP;
EXCEPTION
    WHEN OTHERS THEN
        RAISE NOTICE 'Seed leave balances failed: %', SQLERRM;
END $$;
