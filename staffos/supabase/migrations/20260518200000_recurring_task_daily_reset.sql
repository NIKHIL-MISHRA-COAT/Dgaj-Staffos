-- DGaj Connect: Recurring Task Daily Reset Support
-- Adds last_completed_date to tasks so recurring tasks can be reset each day

-- Add last_completed_date column to track when a recurring task was last completed
ALTER TABLE public.tasks
ADD COLUMN IF NOT EXISTS last_completed_date date DEFAULT NULL;

-- Add next_due_date column to track when the next recurrence should appear
ALTER TABLE public.tasks
ADD COLUMN IF NOT EXISTS next_due_date date DEFAULT NULL;

-- Update the recurring check constraint to allow all supported values
-- First drop the old constraint if it exists
ALTER TABLE public.tasks
DROP CONSTRAINT IF EXISTS tasks_recurring_check;

-- Re-add with all supported recurring values
ALTER TABLE public.tasks
ADD CONSTRAINT tasks_recurring_check
CHECK (recurring IS NULL OR recurring IN ('daily', 'weekly', 'monthly', 'quarterly', 'yearly', 'hourly', 'custom'));

-- Index for efficient querying of recurring tasks that need reset
CREATE INDEX IF NOT EXISTS idx_tasks_recurring_reset
ON public.tasks(recurring, last_completed_date, status)
WHERE recurring IS NOT NULL;
