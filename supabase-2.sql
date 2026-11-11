-- Zone5 · atualização 2: provas partilhadas, prova de cada pessoa no grupo, lembretes
-- Corre isto uma vez no SQL Editor do Supabase (depois do supabase.sql).

-- 1) Provas partilhadas por todos os utilizadores
create table if not exists public.races (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 80),
  city text check (char_length(city) <= 60),
  cc text check (char_length(cc) <= 3),
  date date not null,
  km numeric not null check (km > 0 and km <= 250),
  terrain text not null default 'flat' check (terrain in ('flat','rolling','hilly','trail')),
  created_by uuid not null default auth.uid() references auth.users on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.races enable row level security;
drop policy if exists "ver provas" on public.races;
create policy "ver provas" on public.races for select to authenticated using (true);
drop policy if exists "adicionar provas" on public.races;
create policy "adicionar provas" on public.races for insert to authenticated with check (created_by = auth.uid());
drop policy if exists "editar as minhas provas" on public.races;
create policy "editar as minhas provas" on public.races for update to authenticated using (created_by = auth.uid()) with check (created_by = auth.uid());
drop policy if exists "apagar as minhas provas" on public.races;
create policy "apagar as minhas provas" on public.races for delete to authenticated using (created_by = auth.uid());

-- 2) A prova de cada pessoa (visível só para colegas de grupo)
create table if not exists public.public_profile (
  user_id uuid primary key default auth.uid() references auth.users on delete cascade,
  race_name text check (char_length(race_name) <= 80),
  race_date date,
  race_km numeric,
  updated_at timestamptz not null default now()
);
alter table public.public_profile enable row level security;
drop policy if exists "ver perfis do grupo" on public.public_profile;
create policy "ver perfis do grupo" on public.public_profile for select using (user_id = auth.uid() or public.shares_group(user_id));
drop policy if exists "escrever o meu perfil" on public.public_profile;
create policy "escrever o meu perfil" on public.public_profile for insert with check (user_id = auth.uid());
drop policy if exists "atualizar o meu perfil" on public.public_profile;
create policy "atualizar o meu perfil" on public.public_profile for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 3) Subscrições de lembretes (notificações push)
create table if not exists public.push_subs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  tz text not null default 'Europe/Lisbon',
  hour int not null default 8 check (hour between 0 and 23),
  schedule jsonb not null default '{}'::jsonb,
  last_sent date,
  created_at timestamptz not null default now()
);
alter table public.push_subs enable row level security;
drop policy if exists "as minhas subscrições" on public.push_subs;
create policy "as minhas subscrições" on public.push_subs for all using (user_id = auth.uid()) with check (user_id = auth.uid());
