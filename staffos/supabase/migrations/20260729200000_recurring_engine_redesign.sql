-- DGaj Connect: Recurring Task Engine Redesign
-- Ensures recurring_task_instances is the canonical source of truth for all recurring work
-- Adds client/org fields, proper RLS, bulk-generation function, and overdue automation

-- ── 1. Add missing columns to recurring_tasks (template) ─────────────────────
ALTER TABLE public.recurring_tasks
  ADD COLUMN IF NOT EXISTS client_org_id uuid DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS client_org_name text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS organisation_relates_to text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS priority text DEFAULT 'medium',
  ADD COLUMN IF NOT EXISTS custom_interval_days integer DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS weekday_only boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS notify_before_minutes integer DEFAULT 30,
  ADD COLUMN IF NOT EXISTS time_limit_minutes integer DEFAULT 60,
  ADD COLUMN IF NOT EXISTS workflow_steps jsonb DEFAULT '[]'::jsonb;

-- ── 2. Add missing columns to recurring_task_instances ───────────────────────
ALTER TABLE public.recurring_task_instances
  ADD COLUMN IF NOT EXISTS client_org_id uuid DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS client_org_name text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS organisation_relates_to text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS notify_before_minutes integer DEFAULT 30,
  ADD COLUMN IF NOT EXISTS frequency text DEFAULT 'daily',
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- ── 3. Indexes for performance ────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_rti_due_date_status ON public.recurring_task_instances(due_date, status);
CREATE INDEX IF NOT EXISTS idx_rti_assigned_to_due ON public.recurring_task_instances(assigned_to, due_date);
CREATE INDEX IF NOT EXISTS idx_rti_client_org ON public.recurring_task_instances(client_org_id);
CREATE INDEX IF NOT EXISTS idx_rt_is_active ON public.recurring_tasks(is_active);

-- ── 4. Function: mark overdue instances ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mark_overdue_recurring_instances()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE public.recurring_task_instances
  SET
    status = 'overdue',
    is_overdue = true,
    updated_at = now()
  WHERE
    status IN ('pending', 'in_progress')
    AND due_date < CURRENT_DATE;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- ── 5. Core function: generate instances for a recurring task ─────────────────
-- Generates all instances from p_from_date to p_to_date
-- Skips dates that already have an instance for that user
-- Returns count of newly created instances
CREATE OR REPLACE FUNCTION public.generate_recurring_instances(
  p_recurring_task_id uuid,
  p_from_date date DEFAULT CURRENT_DATE,
  p_to_date date DEFAULT CURRENT_DATE + INTERVAL '30 days'
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_task public.recurring_tasks%ROWTYPE;
  v_user_id uuid;
  v_current_date date;
  v_seq integer;
  v_count integer := 0;
  v_existing_count integer;
  v_due_datetime timestamptz;
  v_start_date date;
  v_diff_days integer;
  v_include boolean;
  v_day_of_week integer;
  v_month_diff integer;
BEGIN
  SELECT * INTO v_task FROM public.recurring_tasks WHERE id = p_recurring_task_id AND is_active = true;
  IF NOT FOUND THEN RETURN 0; END IF;

  -- Clamp from_date to start_date
  v_start_date := COALESCE(v_task.start_date, p_from_date);
  IF p_from_date < v_start_date THEN
    v_current_date := v_start_date;
  ELSE
    v_current_date := p_from_date;
  END IF;

  -- Clamp to_date to end_date if set
  IF v_task.end_date IS NOT NULL AND p_to_date > v_task.end_date THEN
    p_to_date := v_task.end_date;
  END IF;

  -- Nothing to generate if no users assigned
  IF array_length(v_task.assigned_to_users, 1) IS NULL OR array_length(v_task.assigned_to_users, 1) = 0 THEN
    RETURN 0;
  END IF;

  WHILE v_current_date <= p_to_date LOOP
    v_diff_days := v_current_date - v_start_date;
    v_day_of_week := EXTRACT(DOW FROM v_current_date)::integer;
    v_include := false;

    CASE v_task.frequency
      WHEN 'daily' THEN
        v_include := true;
      WHEN 'weekday' THEN
        v_include := v_day_of_week NOT IN (0, 6);
      WHEN 'weekly' THEN
        v_include := (v_diff_days % 7 = 0);
      WHEN 'fortnightly' THEN
        v_include := (v_diff_days % 14 = 0);
      WHEN 'monthly' THEN
        v_include := (EXTRACT(DAY FROM v_current_date) = EXTRACT(DAY FROM v_start_date));
      WHEN 'quarterly' THEN
        v_month_diff := (EXTRACT(YEAR FROM v_current_date) - EXTRACT(YEAR FROM v_start_date))::integer * 12
                      + (EXTRACT(MONTH FROM v_current_date) - EXTRACT(MONTH FROM v_start_date))::integer;
        v_include := (v_month_diff % 3 = 0)
                  AND (EXTRACT(DAY FROM v_current_date) = EXTRACT(DAY FROM v_start_date));
      WHEN 'yearly' THEN
        v_include := (EXTRACT(MONTH FROM v_current_date) = EXTRACT(MONTH FROM v_start_date))
                  AND (EXTRACT(DAY FROM v_current_date) = EXTRACT(DAY FROM v_start_date));
      WHEN 'custom' THEN
        IF COALESCE(v_task.custom_interval_days, 1) > 0 THEN
          v_include := (v_diff_days % COALESCE(v_task.custom_interval_days, 1) = 0);
        END IF;
      ELSE
        v_include := false;
    END CASE;

    -- Apply weekday_only filter
    IF v_task.weekday_only AND v_day_of_week IN (0, 6) THEN
      v_include := false;
    END IF;

    IF v_include THEN
      -- Build due datetime
      v_due_datetime := (v_current_date::text || ' ' || COALESCE(v_task.due_time::text, '17:00:00'))::timestamptz;

      FOREACH v_user_id IN ARRAY v_task.assigned_to_users LOOP
        -- Dedup check
        SELECT COUNT(*) INTO v_existing_count
        FROM public.recurring_task_instances
        WHERE recurring_task_id = p_recurring_task_id
          AND assigned_to = v_user_id
          AND due_date = v_current_date;

        IF v_existing_count = 0 THEN
          -- Get next sequence number for this user
          SELECT COALESCE(MAX(sequence_number), 0) + 1 INTO v_seq
          FROM public.recurring_task_instances
          WHERE recurring_task_id = p_recurring_task_id
            AND assigned_to = v_user_id;

          INSERT INTO public.recurring_task_instances (
            recurring_task_id,
            assigned_to,
            due_date,
            due_datetime,
            due_time,
            status,
            task_name,
            sequence_number,
            assigned_datetime,
            is_overdue,
            priority,
            frequency,
            client_org_id,
            client_org_name,
            organisation_relates_to,
            notify_before_minutes
          ) VALUES (
            p_recurring_task_id,
            v_user_id,
            v_current_date,
            v_due_datetime,
            v_task.due_time,
            CASE WHEN v_current_date < CURRENT_DATE THEN 'overdue' ELSE 'pending' END,
            v_task.title,
            v_seq,
            now(),
            v_current_date < CURRENT_DATE,
            COALESCE(v_task.priority, 'medium'),
            v_task.frequency,
            v_task.client_org_id,
            v_task.client_org_name,
            v_task.organisation_relates_to,
            COALESCE(v_task.notify_before_minutes, 30)
          );
          v_count := v_count + 1;
        END IF;
      END LOOP;
    END IF;

    v_current_date := v_current_date + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

-- ── 6. Function: generate instances for ALL active recurring tasks ────────────
CREATE OR REPLACE FUNCTION public.generate_all_recurring_instances(
  p_days_ahead integer DEFAULT 30
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_task_id uuid;
  v_total integer := 0;
  v_created integer;
  v_today date := CURRENT_DATE;
  v_to_date date := CURRENT_DATE + (p_days_ahead || ' days')::interval;
BEGIN
  -- Mark overdue first
  PERFORM public.mark_overdue_recurring_instances();

  FOR v_task_id IN
    SELECT id FROM public.recurring_tasks
    WHERE is_active = true
      AND (end_date IS NULL OR end_date >= v_today)
      AND (start_date IS NULL OR start_date <= v_to_date)
  LOOP
    SELECT public.generate_recurring_instances(v_task_id, v_today, v_to_date) INTO v_created;
    v_total := v_total + v_created;
  END LOOP;

  RETURN v_total;
END;
$$;

-- ── 7. RLS: ensure all authenticated users can read their own instances ────────
ALTER TABLE public.recurring_task_instances ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rti_select_own" ON public.recurring_task_instances;
CREATE POLICY "rti_select_own" ON public.recurring_task_instances
  FOR SELECT TO authenticated
  USING (
    assigned_to = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid()
        AND role::text IN ('director', 'manager', 'executive')
    )
  );

DROP POLICY IF EXISTS "rti_update_own" ON public.recurring_task_instances;
CREATE POLICY "rti_update_own" ON public.recurring_task_instances
  FOR UPDATE TO authenticated
  USING (
    assigned_to = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid()
        AND role::text IN ('director', 'manager', 'executive')
    )
  )
  WITH CHECK (
    assigned_to = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid()
        AND role::text IN ('director', 'manager', 'executive')
    )
  );

DROP POLICY IF EXISTS "rti_insert_managers" ON public.recurring_task_instances;
CREATE POLICY "rti_insert_managers" ON public.recurring_task_instances
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid()
        AND role::text IN ('director', 'manager', 'executive')
    )
  );

DROP POLICY IF EXISTS "rti_delete_directors" ON public.recurring_task_instances;
CREATE POLICY "rti_delete_directors" ON public.recurring_task_instances
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid()
        AND role::text IN ('director', 'manager', 'executive')
    )
  );

-- ── 8. RLS for recurring_tasks (templates) ───────────────────────────────────
ALTER TABLE public.recurring_tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rt_select_all_auth" ON public.recurring_tasks;
CREATE POLICY "rt_select_all_auth" ON public.recurring_tasks
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "rt_insert_managers" ON public.recurring_tasks;
CREATE POLICY "rt_insert_managers" ON public.recurring_tasks
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid()
        AND role::text IN ('director', 'manager', 'executive')
    )
  );

DROP POLICY IF EXISTS "rt_update_managers" ON public.recurring_tasks;
CREATE POLICY "rt_update_managers" ON public.recurring_tasks
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid()
        AND role::text IN ('director', 'manager', 'executive')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid()
        AND role::text IN ('director', 'manager', 'executive')
    )
  );

DROP POLICY IF EXISTS "rt_delete_directors" ON public.recurring_tasks;
CREATE POLICY "rt_delete_directors" ON public.recurring_tasks
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid()
        AND role::text IN ('director', 'manager', 'executive')
    )
  );
