-- Stage 0b of the anon lockdown: stop anon from listing, downloading or signing
-- files in the private fc-documents bucket (identity and bank documents).
-- Uploads keep working: Storage inserts with RETURNING, so anon still needs a
-- SELECT policy, but only while the Storage operation is an upload.
-- Known effect until the app moves to server-signed URLs (stage 1/2): opening a
-- document inside the app (FC own documents, the Hanwha PDF, the staff mobile
-- dashboard) shows its existing "open failed" alert. The admin web signs URLs with
-- the service role and is unaffected.
-- Re-runnable: every policy is dropped before it is created.

-- Fail fast instead of queueing Storage traffic behind the policy locks.
set local lock_timeout = '3s';

drop policy if exists "fc-documents anon read" on storage.objects;
drop policy if exists "fc-documents anon upload returning" on storage.objects;
create policy "fc-documents anon upload returning"
  on storage.objects for select
  using (
    bucket_id = 'fc-documents'
    and storage.allow_any_operation(array[
      'object.upload', 'object.upload_update', 'object.sign_upload_url', 'object.upload_signed'
    ])
  );

-- These rely on Supabase Auth sessions (profiles.id = auth.uid()); no client signs
-- in with Supabase Auth, while open sign-up would let anyone become role 'fc'.
drop policy if exists "fc-documents read" on storage.objects;
drop policy if exists "fc-documents write" on storage.objects;
drop policy if exists "fc-documents update" on storage.objects;
drop policy if exists "fc-documents delete" on storage.objects;
