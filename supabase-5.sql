-- Zone5 · atualização 5: atividade do grupo, kudos e resumo semanal
-- Corre isto uma vez no SQL Editor do projeto Supabase (SQL Editor → New query → colar → Run).

-- 1) Treinos partilhados com o grupo (aparecem no separador Grupo)
create table if not exists public.activities (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  date date not null,
  kind text not null check (kind in ('run','gym','hyrox','other')),
  title text not null check (char_length(title) <= 120),
  line text check (char_length(line) <= 200),
  pr text check (char_length(pr) <= 200),
  created_at timestamptz not null default now()
);
create index if not exists activities_user_date on public.activities (user_id, date desc);
alter table public.activities enable row level security;
drop policy if exists "ver atividade do grupo" on public.activities;
create policy "ver atividade do grupo" on public.activities for select
  using (user_id = auth.uid() or public.shares_group(user_id));
drop policy if exists "publicar a minha atividade" on public.activities;
create policy "publicar a minha atividade" on public.activities for insert with check (user_id = auth.uid());
drop policy if exists "editar a minha atividade" on public.activities;
create policy "editar a minha atividade" on public.activities for update using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "apagar a minha atividade" on public.activities;
create policy "apagar a minha atividade" on public.activities for delete using (user_id = auth.uid());

-- 2) Kudos (reações) aos treinos
create table if not exists public.kudos (
  activity_id uuid not null references public.activities on delete cascade,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  emoji text not null check (emoji in ('👏','🔥','💪')),
  created_at timestamptz not null default now(),
  primary key (activity_id, user_id)
);
alter table public.kudos enable row level security;
create or replace function public.can_see_activity(a uuid) returns boolean
  language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.activities x where x.id = a and (x.user_id = auth.uid() or public.shares_group(x.user_id)));
$$;
drop policy if exists "ver kudos" on public.kudos;
create policy "ver kudos" on public.kudos for select using (public.can_see_activity(activity_id));
drop policy if exists "dar kudos" on public.kudos;
create policy "dar kudos" on public.kudos for insert with check (user_id = auth.uid() and public.can_see_activity(activity_id));
drop policy if exists "mudar kudos" on public.kudos;
create policy "mudar kudos" on public.kudos for update using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "tirar kudos" on public.kudos;
create policy "tirar kudos" on public.kudos for delete using (user_id = auth.uid());

-- 3) Resumo semanal: sequência de semanas e texto da semana seguinte
alter table public.weekly_stats add column if not exists streak int not null default 0;
alter table public.push_subs add column if not exists weekly jsonb;
alter table public.push_subs add column if not exists last_weekly date;
alter table public.push_subs add column if not exists kudos_seen timestamptz not null default now();
