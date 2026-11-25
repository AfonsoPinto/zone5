-- Zone5 · nível de cada pessoa visível no feed da Comunidade
alter table public.public_profile add column if not exists level int;
