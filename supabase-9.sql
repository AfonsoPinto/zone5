-- Zone5 · fotografias dos treinos no feed do grupo
-- Cada fotografia tem uma visibilidade escolhida pela pessoa:
--   <id>/foto.jpg      → só eu
--   <id>/f/foto.jpg    → amigos (quem partilha um grupo comigo)
--   <id>/a/foto.jpg    → todos (qualquer utilizador da Zone5)

alter table public.activities add column if not exists photo text check (char_length(photo) <= 200);

drop policy if exists "z5 photos read friends" on storage.objects;
drop policy if exists "z5 photos read all" on storage.objects;

create policy "z5 photos read friends" on storage.objects for select to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[2] = 'f'
         and public.shares_group(((storage.foldername(name))[1])::uuid));

create policy "z5 photos read all" on storage.objects for select to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[2] = 'a');
