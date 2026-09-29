-- DGaj Connect: Recurring Task Backfill Fix
-- Fixes the generate_recurring_instances function to backfill from start_date
-- (not just from today), so all missed past instances are created.
-- Also updates generate_all_recurring_instances to use start_date as the from_date.

-- ── 1. Update generate_recurring_instances to support backfill ───────────────
-- The key fix: p_from_date now defaults to the task's own start_date
-- so calling generate_all_recurring_instances() will backfill everything.

CREATE OR REPLACE FUNCTION public.generate_recurring_instances(
  p_recurring_task_id uuid,
  p_from_date date DEFAULT NULL,  -- NULL = use task's start_date (full backfill)
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
  v_effective_from date;
  v_diff_days integer;
  v_include boolean;
  v_day_of_week integer;
  v_month_diff integer;
BEGIN
  SELECT * INTO v_task FROM public.recurring_tasks WHERE id = p_recurring_task_id AND is_active = true;
  IF NOT FOUND THEN RETURN 0; END IF;

  v_start_date := COALESCE(v_task.start_date, CURRENT_DATE);

  -- If p_from_date is NULL, backfill from start_date
  -- Otherwise use the provided from_date (but never before start_date)
  IF p_from_date IS NULL THEN
    v_effective_from := v_start_date;
  ELSE
    v_effective_from := GREATEST(p_from_date, v_start_date);
  END IF;

  -- Clamp to_date to end_date if set
  IF v_task.end_date IS NOT NULL AND p_to_date > v_task.end_date THEN
    p_to_date := v_task.end_date;
  END IF;

  -- Nothing to generate if no users assigned
  IF array_length(v_task.assigned_to_users, 1) IS NULL OR array_length(v_task.assigned_to_users, 1) = 0 THEN
    RETURN 0;
  END IF;

  v_current_date := v_effective_from;

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
      v_due_datetime := (v_current_date::text || ' ' || COALESCE(v_task.due_time::text, '17:00:00'))::timestamptz;

      FOREACH v_user_id IN ARRAY v_task.assigned_to_users LOOP
        -- Dedup check
        SELECT COUNT(*) INTO v_existing_count
        FROM public.recurring_task_instances
        WHERE recurring_task_id = p_recurring_task_id
          AND assigned_to = v_user_id
          AND due_date = v_current_date;

        IF v_existing_count = 0 THEN
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
            -- Past dates → overdue; today and future → pending
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

-- ── 2. Update generate_all_recurring_instances to backfill from start_date ───
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

  -- Pass NULL as from_date so each task backfills from its own start_date
  FOR v_task_id IN
    SELECT id FROM public.recurring_tasks
    WHERE is_active = true
      AND (end_date IS NULL OR end_date >= v_today)
  LOOP
    -- NULL p_from_date triggers backfill from task's start_date
    SELECT public.generate_recurring_instances(v_task_id, NULL, v_to_date) INTO v_created;
    v_total := v_total + v_created;
  END LOOP;

  RETURN v_total;
END;
$$;

-- ── 3. Run immediate backfill for all existing active recurring tasks ─────────
-- This generates all missed instances from each task's start_date to today+30
DO $$
DECLARE
  v_total integer;
BEGIN
  SELECT public.generate_all_recurring_instances(30) INTO v_total;
  RAISE NOTICE 'Backfill complete: % new recurring task instances created', v_total;
END;
$$;
