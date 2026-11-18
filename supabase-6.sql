-- Zone5 · atualização 6: cópia de segurança automática dos planos
-- Corre isto uma vez no SQL Editor (New query → colar → Run).
-- Fica tudo no esquema privado "admin": os utilizadores da app não conseguem ver nem mexer.

create schema if not exists admin;
revoke all on schema admin from anon, authenticated;

-- 1) Histórico: guarda a versão anterior do estado de cada pessoa
create table if not exists admin.user_state_history (
  id bigserial primary key,
  user_id uuid not null,
  state jsonb not null,
  saved_at timestamptz not null default now(),
  motivo text not null
);
create index if not exists ush_user_time on admin.user_state_history (user_id, saved_at desc);
revoke all on admin.user_state_history from anon, authenticated;

-- 2) Antes de cada alteração ou apagamento, guarda a versão antiga.
--    Para não encher a base de dados: guarda sempre que o plano/objetivo muda ou a conta é apagada,
--    e nas restantes alterações no máximo uma cópia por hora. Mantém as últimas 60 cópias por pessoa.
create or replace function admin.backup_user_state() returns trigger
language plpgsql security definer set search_path = admin, public as $$
declare
  motivo text;
  ultima timestamptz;
begin
  if tg_op = 'DELETE' then
    motivo := 'apagado';
  elsif (old.state->'profile') is distinct from (new.state->'profile') then
    motivo := 'plano alterado';
  else
    select max(saved_at) into ultima from admin.user_state_history where user_id = old.user_id;
    if ultima is not null and ultima > now() - interval '1 hour' then
      return coalesce(new, old);
    end if;
    motivo := 'cópia horária';
  end if;
  if old.state ? 'profile' then
    insert into admin.user_state_history (user_id, state, motivo) values (old.user_id, old.state, motivo);
    delete from admin.user_state_history
     where user_id = old.user_id
       and id not in (select id from admin.user_state_history where user_id = old.user_id order by saved_at desc limit 60);
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists backup_user_state on public.user_state;
create trigger backup_user_state
  before update or delete on public.user_state
  for each row execute function admin.backup_user_state();

-- 3) Ver as cópias de toda a gente (mais recentes primeiro)
create or replace view admin.copias as
select h.id, u.email, h.saved_at as guardado_em, h.motivo,
       h.state->'profile'->>'goalType' as objetivo,
       coalesce(h.state->'profile'->>'raceName', '') as prova,
       jsonb_array_length(coalesce(h.state->'logs','[]'::jsonb)) as treinos
from admin.user_state_history h
join auth.users u on u.id = h.user_id
order by h.saved_at desc;
revoke all on admin.copias from anon, authenticated;

-- 4) Repor uma cópia: select admin.repor_copia(ID);  (o ID vem da vista admin.copias)
--    A pessoa só tem de fechar e abrir a app para ver o plano reposto.
create or replace function admin.repor_copia(p_id bigint) returns text
language plpgsql security definer set search_path = admin, public as $$
declare h admin.user_state_history;
begin
  select * into h from admin.user_state_history where id = p_id;
  if not found then return 'Cópia não encontrada'; end if;
  insert into public.user_state (user_id, state, updated_at)
  values (h.user_id, jsonb_set(h.state, '{updated}', to_jsonb((extract(epoch from now()) * 1000)::bigint)), now())
  on conflict (user_id) do update set state = excluded.state, updated_at = now();
  return 'Reposto: cópia de ' || to_char(h.saved_at at time zone 'Europe/Lisbon', 'DD/MM HH24:MI');
end $$;
revoke all on function admin.repor_copia(bigint) from public, anon, authenticated;
