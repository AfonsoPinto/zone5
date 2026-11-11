# Zone5 · ligar o Strava

Tudo está pronto no código. A integração fica desligada até o `STRAVA_CLIENT_ID` ser preenchido no `index.html`.

Requisito do Strava (desde 1 jun 2026): quem cria a app tem de ter subscrição Strava. Até 10 atletas sem revisão.

## 1. Base de dados
SQL Editor → corre `supabase-3.sql`.

## 2. Função
Edge Functions → Deploy a new function → Via Editor.
- **Antes do deploy**, muda o nome para `strava`.
- Cola `supabase/functions/strava/index.ts` → Deploy.
- Na função → Details → desliga **Verify JWT**.

## 3. App no Strava
https://www.strava.com/settings/api
- Application Name: Zone5 · Category: Training
- Website: https://afonsopinto.github.io/zone5/
- **Authorization Callback Domain:** `trnsidilnktcoeppnwhe.supabase.co`
- Ícone: icon-512.png do repositório
- Depois de criada: muda para **Standard Tier** (até 10 atletas).

## 4. Segredos (Edge Functions → Secrets)
- `STRAVA_CLIENT_ID` = Client ID
- `STRAVA_CLIENT_SECRET` = Client Secret (nunca no repositório)
- `STRAVA_VERIFY_TOKEN` = um texto aleatório (guardado fora do repositório)

## 5. Webhook (uma vez)
Abre no navegador: `https://trnsidilnktcoeppnwhe.supabase.co/functions/v1/strava?action=subscribe&key=STRAVA_VERIFY_TOKEN`
Deve responder `201 {"id":…}`. Sem webhook também funciona: a app sincroniza ao abrir.

## 6. Ativar na app
Pôr o Client ID em `CONFIG.STRAVA_CLIENT_ID` no `index.html`.
