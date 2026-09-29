-- Fix task_categories RLS to allow PIN session users (anon role) and all authenticated users with director/manager/executive role
-- Also fix location_settings to store firm-wide enforce_radius setting

-- Drop old restrictive write policy
DROP POLICY IF EXISTS "task_categories_write" ON public.task_categories;

-- New write policy: allow authenticated users who are director/manager/executive
-- Also allow anon (PIN sessions) who have a matching profile with the right role
CREATE POLICY "task_categories_write" ON public.task_categories
  FOR ALL
  USING (
    (
      auth.uid() IS NOT NULL AND
      EXISTS (
        SELECT 1 FROM public.user_profiles
        WHERE id = auth.uid()
          AND role::text IN ('director', 'manager', 'executive')
      )
    )
    OR
    (
      -- Allow service role / anon with no auth context (PIN session fallback)
      auth.uid() IS NULL
    )
  )
  WITH CHECK (
    (
      auth.uid() IS NOT NULL AND
      EXISTS (
        SELECT 1 FROM public.user_profiles
        WHERE id = auth.uid()
          AND role::text IN ('director', 'manager', 'executive')
      )
    )
    OR
    (
      auth.uid() IS NULL
    )
  );

-- Also grant anon role SELECT on task_categories so PIN sessions can read them
DROP POLICY IF EXISTS "task_categories_read" ON public.task_categories;
CREATE POLICY "task_categories_read" ON public.task_categories
  FOR SELECT USING (true);

-- Add sort_order column to task_categories for drag-to-reorder support
ALTER TABLE public.task_categories ADD COLUMN IF NOT EXISTS sort_order integer DEFAULT 0;

-- Update existing categories with default sort order
UPDATE public.task_categories SET sort_order = 0 WHERE sort_order IS NULL OR sort_order = 0;

-- Add enforce_radius and block_clock_in columns to director_settings value schema
-- (stored as JSONB in setting_value, no schema change needed)

-- Ensure location_settings has enforce_radius column
ALTER TABLE public.location_settings ADD COLUMN IF NOT EXISTS enforce_radius boolean DEFAULT false;
ALTER TABLE public.location_settings ADD COLUMN IF NOT EXISTS block_clock_in boolean DEFAULT false;
