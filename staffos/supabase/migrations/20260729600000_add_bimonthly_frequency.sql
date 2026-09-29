-- DGaj Connect: Add bi-monthly frequency support
-- bi-monthly = 15th and 30th of every month
-- Also ensures recurring tasks in the `tasks` table create new rows on completion
-- rather than mutating the existing row.

-- ── 1. Update recurring_tasks frequency check to include bi-monthly ──────────
ALTER TABLE public.recurring_tasks
  DROP CONSTRAINT IF EXISTS recurring_tasks_frequency_check;

ALTER TABLE public.recurring_tasks
  ADD CONSTRAINT recurring_tasks_frequency_check
  CHECK (frequency IN (
    'daily', 'weekday', 'weekly', 'fortnightly',
    'bi-monthly', 'monthly', 'quarterly', 'yearly', 'custom'
  ));

-- ── 2. Update recurring_task_instances frequency check ───────────────────────
ALTER TABLE public.recurring_task_instances
  DROP CONSTRAINT IF EXISTS recurring_task_instances_frequency_check;

-- (no hard constraint on instances — frequency is informational)

-- ── 3. Update generate_recurring_instances to handle bi-monthly ──────────────
CREATE OR REPLACE FUNCTION public.generate_recurring_instances(
  p_recurring_task_id uuid,
  p_from_date date DEFAULT NULL,
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
  v_day_of_month integer;
BEGIN
  SELECT * INTO v_task FROM public.recurring_tasks WHERE id = p_recurring_task_id AND is_active = true;
  IF NOT FOUND THEN RETURN 0; END IF;

  v_start_date := COALESCE(v_task.start_date, CURRENT_DATE);

  IF p_from_date IS NULL THEN
    v_effective_from := v_start_date;
  ELSE
    v_effective_from := GREATEST(p_from_date, v_start_date);
  END IF;

  IF v_task.end_date IS NOT NULL AND p_to_date > v_task.end_date THEN
    p_to_date := v_task.end_date;
  END IF;

  IF array_length(v_task.assigned_to_users, 1) IS NULL OR array_length(v_task.assigned_to_users, 1) = 0 THEN
    RETURN 0;
  END IF;

  v_current_date := v_effective_from;

  WHILE v_current_date <= p_to_date LOOP
    v_diff_days := v_current_date - v_start_date;
    v_day_of_week := EXTRACT(DOW FROM v_current_date)::integer;
    v_day_of_month := EXTRACT(DAY FROM v_current_date)::integer;
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
      WHEN 'bi-monthly' THEN
        -- 15th and last day of month (use 30 as proxy; handles months with <30 days via day clamping)
        v_include := (v_day_of_month = 15)
                  OR (v_day_of_month = 30)
                  OR (
                    -- For months with fewer than 30 days, fire on the last day instead of 30th
                    v_day_of_month = EXTRACT(DAY FROM (DATE_TRUNC('month', v_current_date) + INTERVAL '1 month - 1 day'))::integer
                    AND EXTRACT(DAY FROM (DATE_TRUNC('month', v_current_date) + INTERVAL '1 month - 1 day'))::integer < 30
                  );
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

    IF v_task.weekday_only AND v_day_of_week IN (0, 6) THEN
      v_include := false;
    END IF;

    IF v_include THEN
      v_due_datetime := (v_current_date::text || ' ' || COALESCE(v_task.due_time::text, '17:00:00'))::timestamptz;

      FOREACH v_user_id IN ARRAY v_task.assigned_to_users LOOP
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

-- ── 4. Function: spawn next recurring task instance in `tasks` table ─────────
-- Called when a recurring task (tasks table, not recurring_task_instances) is marked done.
-- Creates a new row for the next occurrence instead of mutating the existing row.
-- Old completed rows are preserved as history.
CREATE OR REPLACE FUNCTION public.spawn_next_task_occurrence(
  p_task_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_task public.tasks%ROWTYPE;
  v_next_due_date date;
  v_day_of_month integer;
  v_new_id uuid;
  v_today date := CURRENT_DATE;
BEGIN
  SELECT * INTO v_task FROM public.tasks WHERE id = p_task_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF v_task.recurring IS NULL OR v_task.recurring = '' THEN RETURN NULL; END IF;
  IF v_task.due_date IS NULL THEN RETURN NULL; END IF;

  v_day_of_month := EXTRACT(DAY FROM v_task.due_date::date)::integer;

  CASE v_task.recurring
    WHEN 'daily' THEN
      v_next_due_date := v_task.due_date::date + 1;
    WHEN 'weekly' THEN
      v_next_due_date := v_task.due_date::date + 7;
    WHEN 'bi-monthly' THEN
      -- Next occurrence: if today is before 15th → 15th; if 15th–29th → 30th; if 30th+ → 15th of next month
      IF v_day_of_month < 15 THEN
        v_next_due_date := DATE_TRUNC('month', v_task.due_date::date)::date + 14; -- 15th
      ELSIF v_day_of_month < 30 THEN
        v_next_due_date := DATE_TRUNC('month', v_task.due_date::date)::date + 29; -- 30th
      ELSE
        v_next_due_date := (DATE_TRUNC('month', v_task.due_date::date) + INTERVAL '1 month')::date + 14; -- 15th of next month
      END IF;
    WHEN 'monthly' THEN
      v_next_due_date := (v_task.due_date::date + INTERVAL '1 month')::date;
    WHEN 'quarterly' THEN
      v_next_due_date := (v_task.due_date::date + INTERVAL '3 months')::date;
    WHEN 'yearly' THEN
      v_next_due_date := (v_task.due_date::date + INTERVAL '1 year')::date;
    ELSE
      -- daily fallback
      v_next_due_date := v_task.due_date::date + 1;
  END CASE;

  -- Don't create if next date already has an instance
  IF EXISTS (
    SELECT 1 FROM public.tasks
    WHERE spawned_from_task_id = p_task_id
      AND due_date = v_next_due_date::text
      AND status NOT IN ('done')
  ) THEN
    RETURN NULL;
  END IF;

  -- Also don't create if the original task itself has a future pending instance
  IF EXISTS (
    SELECT 1 FROM public.tasks
    WHERE id = p_task_id
      AND due_date >= v_today::text
      AND status NOT IN ('done', 'overdue')
  ) THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.tasks (
    title, description, priority, status, due_date, due_time,
    assigned_to, assigned_to_user_id, assigned_to_name, assigned_to_dept,
    assigned_user_ids, assigned_by, assigned_by_name, assigned_by_dept,
    checklist, tags, recurring, notify_before_minutes,
    task_category, client_org_id, client_org_name, organisation_relates_to,
    helper_user_ids, is_active, is_overdue, is_template,
    spawned_from_task_id
  )
  SELECT
    title, description, priority, 'todo', v_next_due_date::text, due_time,
    assigned_to, assigned_to_user_id, assigned_to_name, assigned_to_dept,
    assigned_user_ids, assigned_by, assigned_by_name, assigned_by_dept,
    -- Reset checklist items to not-done
    (
      SELECT jsonb_agg(
        jsonb_set(item, '{done}', 'false'::jsonb)
      )
      FROM jsonb_array_elements(COALESCE(checklist, '[]'::jsonb)) AS item
    ),
    tags, recurring, notify_before_minutes,
    task_category, client_org_id, client_org_name, organisation_relates_to,
    helper_user_ids, true, false, false,
    p_task_id
  FROM public.tasks
  WHERE id = p_task_id
  RETURNING id INTO v_new_id;

  RETURN v_new_id;
END;
$$;

-- ── 5. Add self-referencing parent column for task-spawned recurrences ────────
-- The tasks table already has parent_recurring_task_id referencing recurring_tasks.id
-- We add a separate column for the new spawn-new-row pattern (self-reference to tasks)
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS spawned_from_task_id uuid DEFAULT NULL REFERENCES public.tasks(id) ON DELETE SET NULL;

-- ── 6. Grant execute permissions ─────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION public.spawn_next_task_occurrence(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.spawn_next_task_occurrence(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.generate_recurring_instances(uuid, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_recurring_instances(uuid, date, date) TO anon;

-- ── 7. Run backfill for any existing bi-monthly tasks ────────────────────────
DO $$
DECLARE
  v_total integer;
BEGIN
  SELECT public.generate_all_recurring_instances(30) INTO v_total;
  RAISE NOTICE 'Post-bimonthly-migration backfill: % instances created', v_total;
END;
$$;
