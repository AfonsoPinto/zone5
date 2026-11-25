-- Zone5 · fotografias (perfil e treinos)
-- 1) Fotografia de perfil visível no grupo
alter table public.public_profile add column if not exists avatar text;

-- 2) Pasta privada para as fotografias dos treinos (cada pessoa só vê as suas)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', false, 3145728, array['image/jpeg'])
on conflict (id) do nothing;

drop policy if exists "z5 photos read own" on storage.objects;
drop policy if exists "z5 photos insert own" on storage.objects;
drop policy if exists "z5 photos update own" on storage.objects;
drop policy if exists "z5 photos delete own" on storage.objects;

create policy "z5 photos read own" on storage.objects for select to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "z5 photos insert own" on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "z5 photos update own" on storage.objects for update to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "z5 photos delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
