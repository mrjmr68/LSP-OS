-- Receipt photos for part orders: a private storage bucket that only the
-- active crew can read and write. Skipped where Supabase Storage isn't
-- installed (the local proof database).

do $storage$
begin
  if not exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    raise notice 'No storage schema; skipping the receipts bucket.';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('receipts', 'receipts', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
  on conflict (id) do nothing;

  execute $p$
    create policy receipts_read_member on storage.objects
      for select to authenticated
      using (bucket_id = 'receipts' and public.is_active_member())
  $p$;
  execute $p$
    create policy receipts_write_member on storage.objects
      for insert to authenticated
      with check (bucket_id = 'receipts' and public.is_active_member())
  $p$;
end;
$storage$;
