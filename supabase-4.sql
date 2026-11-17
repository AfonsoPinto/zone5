-- Zone5 · atualização 4: sugestões dos utilizadores
-- Corre isto uma vez no SQL Editor do Supabase.
create table if not exists public.feedback (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  text text not null check (char_length(text) between 2 and 2000),
  screen text,
  lang text,
  created_at timestamptz not null default now()
);
alter table public.feedback enable row level security;
drop policy if exists "enviar sugestões" on public.feedback;
create policy "enviar sugestões" on public.feedback for insert to authenticated with check (user_id = auth.uid());
-- Ninguém na app lê as sugestões; tu vês tudo no Supabase:
-- select f.created_at, u.raw_user_meta_data->>'name' as nome, f.text from public.feedback f join auth.users u on u.id=f.user_id order by f.created_at desc;
