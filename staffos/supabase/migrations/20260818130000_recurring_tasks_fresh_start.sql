-- DGaj Connect: Recurring Tasks — Fresh Start
-- Drops and recreates recurring_tasks + recurring_task_instances with a clean,
-- conflict-free schema. Also recreates all RLS policies and RPC functions.

-- ── 0. Drop dependent objects first (child before parent) ────────────────────

-- Drop policies on instances
DROP POLICY IF EXISTS "rti_select_own"         ON public.recurring_task_instances;
DROP POLICY IF EXISTS "rti_insert_managers"    ON public.recurring_task_instances;
DROP POLICY IF EXISTS "rti_update_own"         ON public.recurring_task_instances;
DROP POLICY IF EXISTS "rti_delete_managers"    ON public.recurring_task_instances;
DROP POLICY IF EXISTS "task_instances_insert"  ON public.recurring_task_instances;
DROP POLICY IF EXISTS "task_instances_update"  ON public.recurring_task_instances;
DROP POLICY IF EXISTS "task_instances_select"  ON public.recurring_task_instances;
DROP POLICY IF EXISTS "task_instances_delete"  ON public.recurring_task_instances;

-- Drop policies on master tasks
DROP POLICY IF EXISTS "recurring_tasks_select"  ON public.recurring_tasks;
DROP POLICY IF EXISTS "recurring_tasks_write"   ON public.recurring_tasks;
DROP POLICY IF EXISTS "rt_insert_managers"      ON public.recurring_tasks;
DROP POLICY IF EXISTS "rt_update_managers"      ON public.recurring_tasks;
DROP POLICY IF EXISTS "rt_delete_directors"     ON public.recurring_tasks;

-- Drop RPC functions
DROP FUNCTION IF EXISTS public.generate_recurring_instances(uuid, date, date);
DROP FUNCTION IF EXISTS public.generate_all_recurring_instances(integer);
DROP FUNCTION IF EXISTS public.mark_overdue_recurring_instances();

-- Drop indexes
DROP INDEX IF EXISTS public.idx_rti_due_date_status;
DROP INDEX IF EXISTS public.idx_rti_assigned_to_due;
DROP INDEX IF EXISTS public.idx_rti_client_org;
DROP INDEX IF EXISTS public.idx_rt_is_active;

-- Drop the instances table first (child)
DROP TABLE IF EXISTS public.recurring_task_instances CASCADE;

-- Drop the master tasks table (parent)
DROP TABLE IF EXISTS public.recurring_tasks CASCADE;

-- ── 1. Recreate recurring_tasks (master templates) ───────────────────────────
CREATE TABLE public.recurring_tasks (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title                 text NOT NULL,
  description           text,
  frequency             text NOT NULL DEFAULT 'daily'
                          CHECK (frequency IN ('daily','weekday','weekly','fortnightly','bi-monthly','monthly','quarterly','yearly','custom')),
  assigned_to_role      text[]   DEFAULT '{}',
  assigned_to_users     uuid[]   DEFAULT '{}',
  department            text,
  time_limit_minutes    integer  DEFAULT 60,
  notify_before_minutes integer  DEFAULT 30,
  checklist             jsonb    DEFAULT '[]',
  workflow_steps        jsonb    DEFAULT '[]',
  is_active             boolean  DEFAULT true,
  created_by            uuid     REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at            timestamptz DEFAULT now(),
  updated_at            timestamptz DEFAULT now(),
  start_date            date     DEFAULT CURRENT_DATE,
  end_date              date,
  due_time              time     DEFAULT '17:00:00',
  custom_interval_days  integer,
  weekday_only          boolean  DEFAULT false,
  priority              text     DEFAULT 'medium',
  client_org_id         uuid,
  client_org_name       text,
  organisation_relates_to text
);

-- ── 2. Recreate recurring_task_instances ─────────────────────────────────────
CREATE TABLE public.recurring_task_instances (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recurring_task_id     uuid REFERENCES public.recurring_tasks(id) ON DELETE CASCADE,
  assigned_to           uuid REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  due_date              date NOT NULL,
  due_time              time,
  due_datetime          timestamptz,
  status                text NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','in_progress','completed','overdue','cancelled')),
  checklist_progress    jsonb    DEFAULT '[]',
  notes                 text,
  task_name             text,
  sequence_number       integer  DEFAULT 1,
  assigned_datetime     timestamptz DEFAULT now(),
  completion_datetime   timestamptz,
  time_taken_minutes    integer,
  is_overdue            boolean  DEFAULT false,
  priority              text     DEFAULT 'medium'
                          CHECK (priority IN ('critical','high','medium','low')),
  frequency             text     DEFAULT 'daily',
  client_org_id         uuid,
  client_org_name       text,
  organisation_relates_to text,
  notify_before_minutes integer  DEFAULT 30,
  cancelled_at          timestamptz,
  cancelled_reason      text,
  created_at            timestamptz DEFAULT now(),
  updated_at            timestamptz DEFAULT now()
);

-- ── 3. Indexes ────────────────────────────────────────────────────────────────
CREATE INDEX idx_rti_due_date_status  ON public.recurring_task_instances(due_date, status);
CREATE INDEX idx_rti_assigned_to_due  ON public.recurring_task_instances(assigned_to, due_date);
CREATE INDEX idx_rti_recurring_task   ON public.recurring_task_instances(recurring_task_id);
CREATE INDEX idx_rt_is_active         ON public.recurring_tasks(is_active);

-- ── 4. Enable RLS ─────────────────────────────────────────────────────────────
ALTER TABLE public.recurring_tasks          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recurring_task_instances ENABLE ROW LEVEL SECURITY;

-- ── 5. RLS Policies: recurring_tasks ─────────────────────────────────────────
CREATE POLICY "rt_select_all_auth"
  ON public.recurring_tasks
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "rt_insert_managers"
  ON public.recurring_tasks
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid()
        AND role IN ('director','manager','executive')
    )
  );

CREATE POLICY "rt_update_managers"
  ON public.recurring_tasks
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid()
        AND role IN ('director','manager','executive')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid()
        AND role IN ('director','manager','executive')
    )
  );

CREATE POLICY "rt_delete_managers"
  ON public.recurring_tasks
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid()
        AND role IN ('director','manager','executive')
    )
  );

-- ── 6. RLS Policies: recurring_task_instances ─────────────────────────────────
CREATE POLICY "rti_select_own"
  ON public.recurring_task_instances
  FOR SELECT TO authenticated
  USING (
    assigned_to = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid()
        AND role IN ('director','manager','executive')
    )
  );

CREATE POLICY "rti_insert_managers"
  ON public.recurring_task_instances
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid()
        AND role IN ('director','manager','executive')
    )
  );

CREATE POLICY "rti_update_own"
  ON public.recurring_task_instances
  FOR UPDATE TO authenticated
  USING (
    assigned_to = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid()
        AND role IN ('director','manager','executive')
    )
  )
  WITH CHECK (
    assigned_to = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid()
        AND role IN ('director','manager','executive')
    )
  );

CREATE POLICY "rti_delete_managers"
  ON public.recurring_task_instances
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid()
        AND role IN ('director','manager','executive')
    )
  );

-- ── 7. Function: mark overdue instances ──────────────────────────────────────
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
    status    = 'overdue',
    is_overdue = true,
    updated_at = now()
  WHERE
    status IN ('pending','in_progress')
    AND due_date < CURRENT_DATE;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- ── 8. Function: generate instances for one recurring task ────────────────────
CREATE OR REPLACE FUNCTION public.generate_recurring_instances(
  p_recurring_task_id uuid,
  p_from_date date DEFAULT CURRENT_DATE,
  p_to_date   date DEFAULT CURRENT_DATE + INTERVAL '30 days'
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_task          public.recurring_tasks%ROWTYPE;
  v_user_id       uuid;
  v_current_date  date;
  v_seq           integer;
  v_count         integer := 0;
  v_existing      integer;
  v_due_datetime  timestamptz;
  v_start_date    date;
  v_diff_days     integer;
  v_include       boolean;
  v_dow           integer;
  v_month_diff    integer;
BEGIN
  SELECT * INTO v_task
  FROM public.recurring_tasks
  WHERE id = p_recurring_task_id AND is_active = true;

  IF NOT FOUND THEN RETURN 0; END IF;

  -- Clamp from_date to task start_date
  v_start_date := COALESCE(v_task.start_date, p_from_date);
  IF p_from_date < v_start_date THEN
    v_current_date := v_start_date;
  ELSE
    v_current_date := p_from_date;
  END IF;

  -- Clamp to_date to task end_date
  IF v_task.end_date IS NOT NULL AND p_to_date > v_task.end_date THEN
    p_to_date := v_task.end_date;
  END IF;

  -- Nothing to do if no users assigned
  IF array_length(v_task.assigned_to_users, 1) IS NULL
     OR array_length(v_task.assigned_to_users, 1) = 0 THEN
    RETURN 0;
  END IF;

  WHILE v_current_date <= p_to_date LOOP
    v_diff_days := v_current_date - v_start_date;
    v_dow       := EXTRACT(DOW FROM v_current_date)::integer;
    v_include   := false;

    CASE v_task.frequency
      WHEN 'daily'       THEN v_include := true;
      WHEN 'weekday'     THEN v_include := v_dow NOT IN (0, 6);
      WHEN 'weekly'      THEN v_include := (v_diff_days % 7 = 0);
      WHEN 'fortnightly' THEN v_include := (v_diff_days % 14 = 0);
      WHEN 'bi-monthly'  THEN
        v_include := EXTRACT(DAY FROM v_current_date) IN (15, 28, 29, 30, 31)
                     AND (
                       EXTRACT(DAY FROM v_current_date) = 15
                       OR v_current_date = (date_trunc('month', v_current_date) + INTERVAL '1 month - 1 day')::date
                     );
      WHEN 'monthly'     THEN
        v_include := (EXTRACT(DAY FROM v_current_date) = EXTRACT(DAY FROM v_start_date));
      WHEN 'quarterly'   THEN
        v_month_diff := (EXTRACT(YEAR  FROM v_current_date) - EXTRACT(YEAR  FROM v_start_date))::integer * 12
                      + (EXTRACT(MONTH FROM v_current_date) - EXTRACT(MONTH FROM v_start_date))::integer;
        v_include := (v_month_diff % 3 = 0)
                  AND (EXTRACT(DAY FROM v_current_date) = EXTRACT(DAY FROM v_start_date));
      WHEN 'yearly'      THEN
        v_include := (EXTRACT(MONTH FROM v_current_date) = EXTRACT(MONTH FROM v_start_date))
                  AND (EXTRACT(DAY   FROM v_current_date) = EXTRACT(DAY   FROM v_start_date));
      WHEN 'custom'      THEN
        IF COALESCE(v_task.custom_interval_days, 1) > 0 THEN
          v_include := (v_diff_days % COALESCE(v_task.custom_interval_days, 1) = 0);
        END IF;
      ELSE v_include := false;
    END CASE;

    -- Apply weekday_only filter
    IF v_task.weekday_only AND v_dow IN (0, 6) THEN
      v_include := false;
    END IF;

    IF v_include THEN
      v_due_datetime := (v_current_date::text || ' ' || COALESCE(v_task.due_time::text, '17:00:00'))::timestamptz;

      FOREACH v_user_id IN ARRAY v_task.assigned_to_users LOOP
        -- Dedup: skip if instance already exists for this user + date
        SELECT COUNT(*) INTO v_existing
        FROM public.recurring_task_instances
        WHERE recurring_task_id = p_recurring_task_id
          AND assigned_to = v_user_id
          AND due_date    = v_current_date;

        IF v_existing = 0 THEN
          SELECT COALESCE(MAX(sequence_number), 0) + 1 INTO v_seq
          FROM public.recurring_task_instances
          WHERE recurring_task_id = p_recurring_task_id
            AND assigned_to = v_user_id;

          INSERT INTO public.recurring_task_instances (
            recurring_task_id,
            assigned_to,
            due_date,
            due_time,
            due_datetime,
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
            v_task.due_time,
            v_due_datetime,
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

-- ── 9. Function: generate instances for ALL active tasks ─────────────────────
CREATE OR REPLACE FUNCTION public.generate_all_recurring_instances(
  p_days_ahead integer DEFAULT 30
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_task_id uuid;
  v_total   integer := 0;
  v_created integer;
  v_today   date := CURRENT_DATE;
  v_to_date date := CURRENT_DATE + (p_days_ahead || ' days')::interval;
BEGIN
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

-- ── 10. Grant EXECUTE to authenticated users ──────────────────────────────────
GRANT EXECUTE ON FUNCTION public.generate_recurring_instances(uuid, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_all_recurring_instances(integer)      TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_overdue_recurring_instances()             TO authenticated;
