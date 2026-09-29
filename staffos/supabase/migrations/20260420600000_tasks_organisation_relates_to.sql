-- Add organisation_relates_to column to tasks table
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS organisation_relates_to text;
