-- Zone5 · atualização 7: registo de erros e funil do registo (anónimo)
-- Corre isto uma vez no SQL Editor (New query → colar → Run).
-- A app só consegue ESCREVER nestas tabelas; ninguém as consegue ler a partir da app.

-- 1) Erros técnicos que acontecem no telemóvel de quem usa a app
create table if not exists public.app_errors (
  id bigserial primary key,
  at timestamptz not null default now(),
  user_id uuid default auth.uid(),
  ver text, msg text, stack text, ctx text, ua text
);
alter table public.app_errors enable row level security;
drop policy if exists "registar erros" on public.app_errors;
create policy "registar erros" on public.app_errors for insert to anon, authenticated
  with check (char_length(coalesce(msg,'')) <= 500 and char_length(coalesce(stack,'')) <= 2000 and char_length(coalesce(ctx,'')) <= 300 and char_length(coalesce(ua,'')) <= 300);

-- 2) Passos da criação do plano (sem dados pessoais: um código aleatório por aparelho)
create table if not exists public.app_events (
  id bigserial primary key,
  at timestamptz not null default now(),
  sess text not null check (char_length(sess) <= 40),
  ev text not null check (char_length(ev) <= 40),
  step text check (char_length(step) <= 40),
  sport text check (char_length(sport) <= 20),
  ver text
);
alter table public.app_events enable row level security;
drop policy if exists "registar passos" on public.app_events;
create policy "registar passos" on public.app_events for insert to anon, authenticated with check (true);

-- 3) Vistas para ti (esquema privado admin)
create schema if not exists admin;
create or replace view admin.erros as
select e.at as quando, coalesce(u.email,'(sem conta)') as quem, e.ver as versao, e.msg as erro, e.ctx as onde, e.ua as aparelho, e.stack as detalhe
from public.app_errors e left join auth.users u on u.id = e.user_id
order by e.at desc;

create or replace view admin.funil as
select coalesce(sport,'—') as desporto, step as passo, count(distinct sess) as pessoas
from public.app_events where ev = 'ob_step' and at > now() - interval '30 days'
group by 1, 2
union all
select coalesce(sport,'—'), '✅ plano criado', count(distinct sess)
from public.app_events where ev = 'ob_done' and at > now() - interval '30 days'
group by 1
order by 1, 3 desc;

revoke all on admin.erros, admin.funil from anon, authenticated;
