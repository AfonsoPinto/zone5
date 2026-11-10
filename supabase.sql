-- Zone5: esquema da base de dados (Supabase / Postgres)
-- Corre isto uma vez no SQL Editor do projeto Supabase.

-- 1) Estado de cada utilizador (plano, registos, ajustes) — privado
create table if not exists public.user_state (
  user_id uuid primary key references auth.users on delete cascade,
  state jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.user_state enable row level security;
drop policy if exists "estado próprio" on public.user_state;
create policy "estado próprio" on public.user_state
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 2) Grupos e membros
create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 60),
  code text not null unique,
  created_by uuid not null default auth.uid() references auth.users on delete cascade,
  created_at timestamptz not null default now()
);
create table if not exists public.group_members (
  group_id uuid not null references public.groups on delete cascade,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 40),
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
alter table public.groups enable row level security;
alter table public.group_members enable row level security;

-- 3) Resumo semanal (o que os colegas de grupo veem)
create table if not exists public.weekly_stats (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  week_start date not null,
  km numeric not null default 0,
  runs int not null default 0,
  planned int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, week_start)
);
alter table public.weekly_stats enable row level security;

-- Funções auxiliares (security definer evita recursão nas políticas)
create or replace function public.is_member(g uuid) returns boolean
language sql security definer set search_path = public stable as $$
  select exists(select 1 from group_members where group_id = g and user_id = auth.uid());
$$;
create or replace function public.shares_group(other uuid) returns boolean
language sql security definer set search_path = public stable as $$
  select exists(
    select 1 from group_members a join group_members b on a.group_id = b.group_id
    where a.user_id = auth.uid() and b.user_id = other);
$$;

-- Políticas
drop policy if exists "ver os meus grupos" on public.groups;
create policy "ver os meus grupos" on public.groups for select using (public.is_member(id));

drop policy if exists "ver membros dos meus grupos" on public.group_members;
create policy "ver membros dos meus grupos" on public.group_members for select using (public.is_member(group_id));
drop policy if exists "mudar o meu nome" on public.group_members;
create policy "mudar o meu nome" on public.group_members for update using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "sair do grupo" on public.group_members;
create policy "sair do grupo" on public.group_members for delete using (user_id = auth.uid());

drop policy if exists "ver resumos do grupo" on public.weekly_stats;
create policy "ver resumos do grupo" on public.weekly_stats for select using (user_id = auth.uid() or public.shares_group(user_id));
drop policy if exists "escrever o meu resumo" on public.weekly_stats;
create policy "escrever o meu resumo" on public.weekly_stats for insert with check (user_id = auth.uid());
drop policy if exists "atualizar o meu resumo" on public.weekly_stats;
create policy "atualizar o meu resumo" on public.weekly_stats for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Só o nome pode ser alterado diretamente (não o grupo)
revoke update on public.group_members from authenticated, anon;
grant update (display_name) on public.group_members to authenticated;

-- Criar grupo e entrar por código (únicas formas de entrar num grupo)
create or replace function public.create_group(p_name text, p_display text) returns uuid
language plpgsql security definer set search_path = public as $$
declare gid uuid; c text;
begin
  if auth.uid() is null then raise exception 'sem sessão'; end if;
  loop
    c := translate(upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6)), '01', 'GH');
    exit when length(c) = 6 and not exists(select 1 from groups where code = c);
  end loop;
  insert into groups(name, code, created_by) values (left(trim(p_name), 60), c, auth.uid()) returning id into gid;
  insert into group_members(group_id, user_id, display_name) values (gid, auth.uid(), left(trim(p_display), 40));
  return gid;
end; $$;

create or replace function public.join_group(p_code text, p_display text) returns uuid
language plpgsql security definer set search_path = public as $$
declare gid uuid;
begin
  if auth.uid() is null then raise exception 'sem sessão'; end if;
  select id into gid from groups where code = upper(trim(p_code));
  if gid is null then return null; end if;
  insert into group_members(group_id, user_id, display_name)
    values (gid, auth.uid(), left(trim(p_display), 40))
    on conflict (group_id, user_id) do nothing;
  return gid;
end; $$;

grant execute on function public.create_group(text, text) to authenticated;
grant execute on function public.join_group(text, text) to authenticated;
revoke execute on function public.create_group(text, text) from anon;
revoke execute on function public.join_group(text, text) from anon;
