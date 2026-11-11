-- Zone5 · atualização 3: integração com o Strava
-- Corre isto uma vez no SQL Editor do Supabase (depois do supabase-2.sql).

-- Tokens do Strava: só o servidor (Edge Function) lê e escreve. Sem políticas = ninguém na app lhes acede.
create table if not exists public.strava_tokens (
  user_id uuid primary key references auth.users on delete cascade,
  athlete_id bigint not null unique,
  access_token text not null,
  refresh_token text not null,
  expires_at bigint not null,
  scope text,
  updated_at timestamptz not null default now()
);
alter table public.strava_tokens enable row level security;

-- Pedidos de ligação pendentes (protege o regresso do Strava)
create table if not exists public.strava_states (
  nonce text primary key,
  user_id uuid not null references auth.users on delete cascade,
  return_url text not null,
  created_at timestamptz not null default now()
);
alter table public.strava_states enable row level security;

-- Estado da ligação, visível para o próprio
create table if not exists public.strava_link (
  user_id uuid primary key references auth.users on delete cascade,
  athlete_id bigint not null,
  athlete_name text,
  shoes jsonb not null default '[]'::jsonb,
  last_sync bigint not null default 0,
  connected_at timestamptz not null default now()
);
alter table public.strava_link enable row level security;
drop policy if exists "ver a minha ligação strava" on public.strava_link;
create policy "ver a minha ligação strava" on public.strava_link for select using (user_id = auth.uid());

-- Atividades recebidas do Strava, à espera de serem analisadas pela app
create table if not exists public.strava_activities (
  id bigint primary key,
  user_id uuid not null references auth.users on delete cascade,
  start_date date not null,
  data jsonb not null,
  backfill boolean not null default false,
  deleted boolean not null default false,
  processed boolean not null default false,
  updated_at timestamptz not null default now()
);
create index if not exists strava_activities_user_idx on public.strava_activities (user_id, processed);
alter table public.strava_activities enable row level security;
drop policy if exists "ver as minhas atividades" on public.strava_activities;
create policy "ver as minhas atividades" on public.strava_activities for select using (user_id = auth.uid());
drop policy if exists "marcar as minhas atividades" on public.strava_activities;
create policy "marcar as minhas atividades" on public.strava_activities for update using (user_id = auth.uid()) with check (user_id = auth.uid());
