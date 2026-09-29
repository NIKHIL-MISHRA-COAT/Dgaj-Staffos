-- Delete all existing task records (children first, then parents)
-- This clears all task data while preserving table structure and RLS policies

DO $$
BEGIN
  -- Delete child/dependent records first
  DELETE FROM public.task_time_entries;
  DELETE FROM public.task_dependencies;
  DELETE FROM public.task_activity;
  DELETE FROM public.task_comments;
  DELETE FROM public.task_notes;
  DELETE FROM public.task_collaborators;
  DELETE FROM public.task_instances;
  DELETE FROM public.recurring_task_instances;
  DELETE FROM public.recurring_task_spawn_log;
  DELETE FROM public.recurring_tasks;

  -- Delete parent task records last
  DELETE FROM public.tasks;

  RAISE NOTICE 'All task records deleted successfully.';
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Error deleting task records: %', SQLERRM;
    RAISE;
END $$;
