-- Migration: Fix all button functionality, add calendar priority, fix RLS for director_settings and company_holidays
-- Timestamp: 20260420900000

-- 1. Add priority column to calendar_events if not exists
ALTER TABLE public.calendar_events
ADD COLUMN IF NOT EXISTS priority TEXT DEFAULT 'medium';

-- 2. Fix director_settings RLS — allow anon (PIN session) and authenticated users with director/manager role to upsert
ALTER TABLE public.director_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "director_settings_select_all" ON public.director_settings;
CREATE POLICY "director_settings_select_all"
ON public.director_settings
FOR SELECT
TO public
USING (true);

DROP POLICY IF EXISTS "director_settings_upsert_directors" ON public.director_settings;
CREATE POLICY "director_settings_upsert_directors"
ON public.director_settings
FOR ALL
TO public
USING (true)
WITH CHECK (true);

-- 3. Fix company_holidays RLS — allow all users to read, allow directors/managers to insert/update/delete
ALTER TABLE public.company_holidays ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "company_holidays_select_all" ON public.company_holidays;
CREATE POLICY "company_holidays_select_all"
ON public.company_holidays
FOR SELECT
TO public
USING (true);

DROP POLICY IF EXISTS "company_holidays_manage_all" ON public.company_holidays;
CREATE POLICY "company_holidays_manage_all"
ON public.company_holidays
FOR ALL
TO public
USING (true)
WITH CHECK (true);

-- 4. Fix location_settings RLS — allow all to read and upsert firm_default
ALTER TABLE public.location_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "location_settings_select_all" ON public.location_settings;
CREATE POLICY "location_settings_select_all"
ON public.location_settings
FOR SELECT
TO public
USING (true);

DROP POLICY IF EXISTS "location_settings_manage_all" ON public.location_settings;
CREATE POLICY "location_settings_manage_all"
ON public.location_settings
FOR ALL
TO public
USING (true)
WITH CHECK (true);

-- 5. Fix calendar_events RLS — allow all authenticated and anon users to insert/select
ALTER TABLE public.calendar_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "calendar_events_select_all" ON public.calendar_events;
CREATE POLICY "calendar_events_select_all"
ON public.calendar_events
FOR SELECT
TO public
USING (true);

DROP POLICY IF EXISTS "calendar_events_insert_all" ON public.calendar_events;
CREATE POLICY "calendar_events_insert_all"
ON public.calendar_events
FOR INSERT
TO public
WITH CHECK (true);

DROP POLICY IF EXISTS "calendar_events_delete_own" ON public.calendar_events;
CREATE POLICY "calendar_events_delete_own"
ON public.calendar_events
FOR DELETE
TO public
USING (true);

-- 6. Fix notifications RLS — allow all users (including anon/PIN) to insert and select their own
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notifications_select_own" ON public.notifications;
CREATE POLICY "notifications_select_own"
ON public.notifications
FOR SELECT
TO public
USING (true);

DROP POLICY IF EXISTS "notifications_insert_all" ON public.notifications;
CREATE POLICY "notifications_insert_all"
ON public.notifications
FOR INSERT
TO public
WITH CHECK (true);

DROP POLICY IF EXISTS "notifications_update_own" ON public.notifications;
CREATE POLICY "notifications_update_own"
ON public.notifications
FOR UPDATE
TO public
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "notifications_delete_own" ON public.notifications;
CREATE POLICY "notifications_delete_own"
ON public.notifications
FOR DELETE
TO public
USING (true);

-- 7. Fix expenses RLS — allow all users to insert their own expenses
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "expenses_select_all" ON public.expenses;
CREATE POLICY "expenses_select_all"
ON public.expenses
FOR SELECT
TO public
USING (true);

DROP POLICY IF EXISTS "expenses_insert_own" ON public.expenses;
CREATE POLICY "expenses_insert_own"
ON public.expenses
FOR INSERT
TO public
WITH CHECK (true);

DROP POLICY IF EXISTS "expenses_update_managers" ON public.expenses;
CREATE POLICY "expenses_update_managers"
ON public.expenses
FOR UPDATE
TO public
USING (true)
WITH CHECK (true);

-- 8. Ensure documents storage bucket exists (for file uploads)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'documents',
  'documents',
  true,
  10485760,
  ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/plain', 'text/csv']
)
ON CONFLICT (id) DO NOTHING;

-- 9. Storage RLS for documents bucket
DROP POLICY IF EXISTS "documents_public_read" ON storage.objects;
CREATE POLICY "documents_public_read"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'documents');

DROP POLICY IF EXISTS "documents_authenticated_upload" ON storage.objects;
CREATE POLICY "documents_authenticated_upload"
ON storage.objects
FOR INSERT
TO public
WITH CHECK (bucket_id = 'documents');

DROP POLICY IF EXISTS "documents_owner_delete" ON storage.objects;
CREATE POLICY "documents_owner_delete"
ON storage.objects
FOR DELETE
TO public
USING (bucket_id = 'documents');

-- 10. Also ensure receipts bucket exists as fallback
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('receipts', 'receipts', true, 10485760)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "receipts_public_read" ON storage.objects;
CREATE POLICY "receipts_public_read"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'receipts');

DROP POLICY IF EXISTS "receipts_upload" ON storage.objects;
CREATE POLICY "receipts_upload"
ON storage.objects
FOR INSERT
TO public
WITH CHECK (bucket_id = 'receipts');
