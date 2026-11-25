-- Zone5 · treinador IA: contador de pedidos por pessoa e por dia (máx. 8)
create table if not exists public.ai_usage (
  user_id uuid not null references auth.users on delete cascade,
  day date not null,
  n int not null default 0,
  primary key (user_id, day)
);
alter table public.ai_usage enable row level security;
-- sem políticas: só a função "coach" (com a chave de serviço) lê e escreve
