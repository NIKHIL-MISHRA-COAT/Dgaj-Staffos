-- DGaj Connect: Task Instances Architecture
-- Enhances recurring_task_instances table with full work-record columns
-- Adds sequence_number, overdue_flag, time_taken, assigned_datetime, completion_datetime

-- Add missing columns to recurring_task_instances
ALTER TABLE public.recurring_task_instances
  ADD COLUMN IF NOT EXISTS sequence_number integer DEFAULT 1,
  ADD COLUMN IF NOT EXISTS task_name text,
  ADD COLUMN IF NOT EXISTS assigned_datetime timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS due_datetime timestamptz,
  ADD COLUMN IF NOT EXISTS completion_datetime timestamptz,
  ADD COLUMN IF NOT EXISTS time_taken_minutes integer,
  ADD COLUMN IF NOT EXISTS is_overdue boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS assigned_to_name text,
  ADD COLUMN IF NOT EXISTS assigned_to_dept text,
  ADD COLUMN IF NOT EXISTS priority text DEFAULT 'medium' CHECK (priority IN ('critical', 'high', 'medium', 'low')),
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_reason text;

-- Update status check to include cancelled
ALTER TABLE public.recurring_task_instances
  DROP CONSTRAINT IF EXISTS recurring_task_instances_status_check;

ALTER TABLE public.recurring_task_instances
  ADD CONSTRAINT recurring_task_instances_status_check
  CHECK (status IN ('pending', 'in_progress', 'completed', 'overdue', 'cancelled'));

-- Add assigned_to_users array to recurring_tasks for specific user assignment
ALTER TABLE public.recurring_tasks
  ADD COLUMN IF NOT EXISTS assigned_to_users uuid[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS start_date date DEFAULT CURRENT_DATE,
  ADD COLUMN IF NOT EXISTS end_date date,
  ADD COLUMN IF NOT EXISTS due_time time DEFAULT '17:00:00';

-- Index for efficient querying by date and status
CREATE INDEX IF NOT EXISTS idx_rti_due_date ON public.recurring_task_instances(due_date);
CREATE INDEX IF NOT EXISTS idx_rti_assigned_to ON public.recurring_task_instances(assigned_to);
CREATE INDEX IF NOT EXISTS idx_rti_status ON public.recurring_task_instances(status);
CREATE INDEX IF NOT EXISTS idx_rti_recurring_task_id ON public.recurring_task_instances(recurring_task_id);
CREATE INDEX IF NOT EXISTS idx_rti_is_overdue ON public.recurring_task_instances(is_overdue);

-- Function to auto-mark instances as overdue
CREATE OR REPLACE FUNCTION public.mark_overdue_task_instances()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.recurring_task_instances
  SET
    status = 'overdue',
    is_overdue = true
  WHERE
    status IN ('pending', 'in_progress')
    AND due_date < CURRENT_DATE;
END;
$$;

-- Function to generate task instances for a recurring task
CREATE OR REPLACE FUNCTION public.generate_task_instances(
  p_recurring_task_id uuid,
  p_from_date date DEFAULT CURRENT_DATE,
  p_to_date date DEFAULT CURRENT_DATE
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
BEGIN
  SELECT * INTO v_task FROM public.recurring_tasks WHERE id = p_recurring_task_id AND is_active = true;
  IF NOT FOUND THEN RETURN 0; END IF;

  v_current_date := p_from_date;

  WHILE v_current_date <= p_to_date LOOP
    -- Skip if frequency doesn't match
    IF v_task.frequency = 'weekly' AND EXTRACT(DOW FROM v_current_date) != 1 THEN
      v_current_date := v_current_date + 1;
      CONTINUE;
    END IF;
    IF v_task.frequency = 'monthly' AND EXTRACT(DAY FROM v_current_date) != 1 THEN
      v_current_date := v_current_date + 1;
      CONTINUE;
    END IF;

    -- Build due datetime
    v_due_datetime := (v_current_date::text || ' ' || COALESCE(v_task.due_time::text, '17:00:00'))::timestamptz;

    -- Generate for each assigned user
    IF array_length(v_task.assigned_to_users, 1) > 0 THEN
      FOREACH v_user_id IN ARRAY v_task.assigned_to_users LOOP
        -- Check if instance already exists for this user+date
        SELECT COUNT(*) INTO v_existing_count
        FROM public.recurring_task_instances
        WHERE recurring_task_id = p_recurring_task_id
          AND assigned_to = v_user_id
          AND due_date = v_current_date;

        IF v_existing_count = 0 THEN
          -- Get sequence number for this user
          SELECT COALESCE(MAX(sequence_number), 0) + 1 INTO v_seq
          FROM public.recurring_task_instances
          WHERE recurring_task_id = p_recurring_task_id
            AND assigned_to = v_user_id;

          INSERT INTO public.recurring_task_instances (
            recurring_task_id, assigned_to, due_date, due_datetime,
            status, task_name, sequence_number, assigned_datetime,
            is_overdue, priority
          ) VALUES (
            p_recurring_task_id, v_user_id, v_current_date, v_due_datetime,
            CASE WHEN v_current_date < CURRENT_DATE THEN 'overdue' ELSE 'pending' END,
            v_task.title, v_seq, now(),
            v_current_date < CURRENT_DATE, 'medium'
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

-- RLS: allow managers/directors to insert instances
DROP POLICY IF EXISTS "task_instances_insert" ON public.recurring_task_instances;
CREATE POLICY "task_instances_insert" ON public.recurring_task_instances
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role::text IN ('director', 'manager', 'executive'))
  );

DROP POLICY IF EXISTS "task_instances_update" ON public.recurring_task_instances;
CREATE POLICY "task_instances_update" ON public.recurring_task_instances
  FOR UPDATE TO authenticated
  USING (
    assigned_to = auth.uid()
    OR EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role::text IN ('director', 'manager', 'executive'))
  );
