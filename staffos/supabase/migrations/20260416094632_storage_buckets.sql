-- Create storage bucket for employee documents
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'employee-documents',
    'employee-documents',
    false,
    52428800,
    ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
)
ON CONFLICT (id) DO NOTHING;

-- RLS for storage
DROP POLICY IF EXISTS "users_upload_own_documents" ON storage.objects;
CREATE POLICY "users_upload_own_documents"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
    bucket_id = 'employee-documents' AND
    (storage.foldername(name))[1] = auth.uid()::text
);

DROP POLICY IF EXISTS "users_view_own_documents" ON storage.objects;
CREATE POLICY "users_view_own_documents"
ON storage.objects
FOR SELECT
TO authenticated
USING (
    bucket_id = 'employee-documents' AND
    (storage.foldername(name))[1] = auth.uid()::text
);

DROP POLICY IF EXISTS "users_delete_own_documents" ON storage.objects;
CREATE POLICY "users_delete_own_documents"
ON storage.objects
FOR DELETE
TO authenticated
USING (
    bucket_id = 'employee-documents' AND
    (storage.foldername(name))[1] = auth.uid()::text
);
