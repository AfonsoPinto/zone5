-- Zone5 · comunidade: feed com os treinos de toda a gente (substitui os grupos)
-- Corre isto uma vez no SQL Editor (New query → colar → Run).

-- 1) Perfil público: nome, fotografia e se quer aparecer no feed
alter table public.public_profile add column if not exists name text check (char_length(name) <= 60);
alter table public.public_profile add column if not exists feed boolean not null default true;
alter table public.public_profile add column if not exists avatar text;
drop policy if exists "ver perfis do grupo" on public.public_profile;
drop policy if exists "ver perfis" on public.public_profile;
create policy "ver perfis" on public.public_profile for select to authenticated using (true);

-- 2) Treinos: qualquer utilizador com sessão iniciada vê o feed
alter table public.activities add column if not exists photo text check (char_length(photo) <= 200);
drop policy if exists "ver atividade do grupo" on public.activities;
drop policy if exists "ver atividade" on public.activities;
create policy "ver atividade" on public.activities for select to authenticated using (true);

-- 3) Kudos: qualquer pessoa pode reagir a qualquer treino do feed
create or replace function public.can_see_activity(a uuid) returns boolean
  language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.activities x where x.id = a);
$$;

-- 4) Fotografias: só as marcadas como públicas (pasta /a/) são visíveis aos outros
drop policy if exists "z5 photos read friends" on storage.objects;
drop policy if exists "z5 photos read all" on storage.objects;
create policy "z5 photos read all" on storage.objects for select to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[2] = 'a');
