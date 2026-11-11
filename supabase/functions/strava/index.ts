// Zone5 · integração com o Strava (Edge Function "strava", com "Verify JWT" desligado).
// Segredos (Edge Functions → Secrets): STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET, STRAVA_VERIFY_TOKEN.
// Ações (?action=…):
//   start       (app, com sessão)  → devolve o link de autorização do Strava
//   callback    (Strava)           → troca o código por tokens, importa sapatilhas e últimos 90 dias, volta à app
//   sync        (app, com sessão)  → vai buscar corridas novas e atualiza as sapatilhas
//   describe    (app, com sessão)  → acrescenta o resultado Zone5 à descrição da atividade
//   disconnect  (app, com sessão)  → desliga o Strava e apaga os tokens
//   webhook     (Strava)           → recebe atividades novas, alteradas ou apagadas
//   subscribe   (tu, uma vez)      → regista o webhook: abre ?action=subscribe&key=STRAVA_VERIFY_TOKEN
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const API = "https://www.strava.com/api/v3"; // a partir de 1 jun 2027: https://www.api-v3.strava.com
const OAUTH = "https://www.strava.com/oauth";
const RUN_TYPES = ["Run", "TrailRun", "VirtualRun"];
const env = (k: string) => Deno.env.get(k) ?? "";
const sb = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (x: unknown, status = 200) =>
  new Response(JSON.stringify(x), { status, headers: { ...CORS, "content-type": "application/json" } });
const fnUrl = () => env("STRAVA_FUNCTION_URL") || `${env("SUPABASE_URL")}/functions/v1/strava`;

async function userFrom(req: Request) {
  const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt) return null;
  const { data } = await sb.auth.getUser(jwt);
  return data?.user ?? null;
}

async function tokenFor(userId: string) {
  const { data: t } = await sb.from("strava_tokens").select("*").eq("user_id", userId).maybeSingle();
  if (!t) return null;
  if (t.expires_at - 120 > Date.now() / 1000) return t;
  const r = await fetch(`${OAUTH}/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_id: env("STRAVA_CLIENT_ID"), client_secret: env("STRAVA_CLIENT_SECRET"), grant_type: "refresh_token", refresh_token: t.refresh_token }),
  });
  if (!r.ok) return null;
  const j = await r.json();
  const nt = { ...t, access_token: j.access_token, refresh_token: j.refresh_token, expires_at: j.expires_at, updated_at: new Date().toISOString() };
  await sb.from("strava_tokens").update(nt).eq("user_id", userId);
  return nt;
}

const get = (tok: string, path: string) => fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${tok}` } });

function slim(a: Record<string, any>) {
  return {
    name: a.name, sport_type: a.sport_type ?? a.type, start_date_local: a.start_date_local,
    distance: a.distance, moving_time: a.moving_time, elapsed_time: a.elapsed_time,
    average_heartrate: a.average_heartrate ?? null, max_heartrate: a.max_heartrate ?? null,
    total_elevation_gain: a.total_elevation_gain ?? 0, gear_id: a.gear_id ?? null,
    perceived_exertion: a.perceived_exertion ?? null, workout_type: a.workout_type ?? null,
    splits: (a.splits_metric ?? []).map((s: any) => ({ d: s.distance, t: s.moving_time, hr: s.average_heartrate ?? null })),
    laps: (a.laps ?? []).map((l: any) => ({ d: l.distance, t: l.moving_time })),
    best: (a.best_efforts ?? []).map((b: any) => ({ n: b.name, d: b.distance, t: b.moving_time })),
    detailed: !!a.splits_metric,
  };
}

async function storeActivity(userId: string, tok: string, id: number, backfill = false) {
  const r = await get(tok, `/activities/${id}?include_all_efforts=false`);
  if (!r.ok) return false;
  const a = await r.json();
  if (!RUN_TYPES.includes(a.sport_type ?? a.type)) return false;
  await sb.from("strava_activities").upsert({
    id: a.id, user_id: userId, start_date: String(a.start_date_local).slice(0, 10), data: slim(a),
    backfill, deleted: false, processed: false, updated_at: new Date().toISOString(),
  });
  return true;
}

async function refreshShoes(userId: string, tok: string) {
  const r = await get(tok, "/athlete");
  if (!r.ok) return;
  const a = await r.json();
  const shoes = (a.shoes ?? []).map((s: any) => ({ id: s.id, name: s.name, km: Math.round((s.distance ?? 0) / 100) / 10, retired: !!s.retired }));
  await sb.from("strava_link").update({ shoes, athlete_name: [a.firstname, a.lastname].filter(Boolean).join(" ") }).eq("user_id", userId);
}

async function syncUser(userId: string, max = 12) {
  const t = await tokenFor(userId);
  if (!t) return { ok: false };
  const { data: link } = await sb.from("strava_link").select("last_sync").eq("user_id", userId).maybeSingle();
  const after = Math.max(link?.last_sync ?? 0, Math.floor(Date.now() / 1000) - 14 * 86400);
  const r = await get(t.access_token, `/athlete/activities?after=${after}&per_page=50`);
  if (!r.ok) return { ok: false };
  const list = (await r.json()) as any[];
  const { data: have } = await sb.from("strava_activities").select("id").eq("user_id", userId).in("id", list.map((x) => x.id).concat([0]));
  const known = new Set((have ?? []).map((x: any) => Number(x.id)));
  let n = 0, newest = link?.last_sync ?? 0;
  for (const a of list.sort((x, y) => (x.start_date < y.start_date ? -1 : 1))) {
    const ts = Math.floor(Date.parse(a.start_date) / 1000);
    if (known.has(Number(a.id)) || !RUN_TYPES.includes(a.sport_type ?? a.type)) { newest = Math.max(newest, ts); continue; }
    if (n >= max) break;
    if (await storeActivity(userId, t.access_token, a.id)) n++;
    newest = Math.max(newest, ts);
  }
  await sb.from("strava_link").update({ last_sync: newest }).eq("user_id", userId);
  await refreshShoes(userId, t.access_token);
  return { ok: true, added: n };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const url = new URL(req.url);
  const action = url.searchParams.get("action") ?? "";

  // ---- Webhook do Strava ----
  if (action === "webhook") {
    if (req.method === "GET") {
      if (url.searchParams.get("hub.verify_token") !== env("STRAVA_VERIFY_TOKEN")) return new Response("forbidden", { status: 403 });
      return json({ "hub.challenge": url.searchParams.get("hub.challenge") });
    }
    const ev = await req.json().catch(() => null);
    if (!ev) return json({ ok: true });
    const { data: t } = await sb.from("strava_tokens").select("user_id").eq("athlete_id", ev.owner_id).maybeSingle();
    if (!t) return json({ ok: true });
    if (ev.object_type === "athlete" && ev.updates?.authorized === "false") {
      await sb.from("strava_tokens").delete().eq("user_id", t.user_id);
      await sb.from("strava_link").delete().eq("user_id", t.user_id);
      return json({ ok: true });
    }
    if (ev.object_type === "activity") {
      if (ev.aspect_type === "delete") {
        await sb.from("strava_activities").update({ deleted: true, processed: false, updated_at: new Date().toISOString() }).eq("id", ev.object_id);
      } else {
        const tok = await tokenFor(t.user_id);
        if (tok) {
          const { data: ex } = await sb.from("strava_activities").select("processed").eq("id", ev.object_id).maybeSingle();
          if (!(ev.aspect_type === "update" && ex?.processed)) await storeActivity(t.user_id, tok.access_token, ev.object_id);
        }
      }
    }
    return json({ ok: true });
  }

  // ---- Registar o webhook (uma vez) ----
  if (action === "subscribe") {
    if (url.searchParams.get("key") !== env("STRAVA_VERIFY_TOKEN")) return new Response("forbidden", { status: 403 });
    const fd = new FormData();
    fd.append("client_id", env("STRAVA_CLIENT_ID"));
    fd.append("client_secret", env("STRAVA_CLIENT_SECRET"));
    fd.append("callback_url", `${fnUrl()}?action=webhook`);
    fd.append("verify_token", env("STRAVA_VERIFY_TOKEN"));
    const r = await fetch(`${API}/push_subscriptions`, { method: "POST", body: fd });
    return new Response(`${r.status} ${await r.text()}`, { headers: { "content-type": "text/plain" } });
  }

  // ---- Regresso do Strava depois de autorizar ----
  if (action === "callback") {
    const state = url.searchParams.get("state") ?? "";
    const { data: s } = await sb.from("strava_states").select("*").eq("nonce", state).maybeSingle();
    if (!s) return new Response("Ligação expirada. Volta à Zone5 e tenta outra vez.", { status: 400 });
    await sb.from("strava_states").delete().eq("nonce", state);
    const back = (q: string) => Response.redirect(`${s.return_url}?strava=${q}`, 302);
    const code = url.searchParams.get("code");
    const scope = url.searchParams.get("scope") ?? "";
    if (!code || url.searchParams.get("error")) return back("cancel");
    if (!scope.includes("activity:read")) return back("scope");
    const r = await fetch(`${OAUTH}/token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_id: env("STRAVA_CLIENT_ID"), client_secret: env("STRAVA_CLIENT_SECRET"), code, grant_type: "authorization_code" }),
    });
    if (!r.ok) return back("error");
    const j = await r.json();
    const ath = j.athlete ?? {};
    await sb.from("strava_tokens").delete().eq("athlete_id", ath.id).neq("user_id", s.user_id);
    await sb.from("strava_tokens").upsert({ user_id: s.user_id, athlete_id: ath.id, access_token: j.access_token, refresh_token: j.refresh_token, expires_at: j.expires_at, scope, updated_at: new Date().toISOString() });
    const since = Math.floor(Date.now() / 1000) - 90 * 86400;
    await sb.from("strava_link").upsert({ user_id: s.user_id, athlete_id: ath.id, athlete_name: [ath.firstname, ath.lastname].filter(Boolean).join(" "), last_sync: since, connected_at: new Date().toISOString() });
    // últimos 90 dias (resumo) para estimar a forma, sem gastar pedidos em detalhes
    try {
      const rows: any[] = [];
      for (let page = 1; page <= 2; page++) {
        const lr = await get(j.access_token, `/athlete/activities?after=${since}&per_page=100&page=${page}`);
        if (!lr.ok) break;
        const list = (await lr.json()) as any[];
        for (const a of list) if (RUN_TYPES.includes(a.sport_type ?? a.type)) rows.push({ id: a.id, user_id: s.user_id, start_date: String(a.start_date_local).slice(0, 10), data: slim(a), backfill: true, deleted: false, processed: false });
        if (list.length < 100) break;
      }
      if (rows.length) await sb.from("strava_activities").upsert(rows, { ignoreDuplicates: true });
      const newest = rows.reduce((m, x) => Math.max(m, Math.floor(Date.parse(x.data.start_date_local + "Z") / 1000)), since);
      await sb.from("strava_link").update({ last_sync: newest }).eq("user_id", s.user_id);
      await refreshShoes(s.user_id, j.access_token);
    } catch (_) { /* a sincronização seguinte trata do resto */ }
    return back("ok");
  }

  // ---- Ações da app (precisam de sessão) ----
  const user = await userFrom(req);
  if (!user) return json({ error: "unauthorized" }, 401);
  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};

  if (action === "start") {
    const ret = String(body.return_url ?? "");
    if (!/^https:\/\//.test(ret) || !env("STRAVA_CLIENT_ID")) return json({ error: "bad request" }, 400);
    const nonce = crypto.randomUUID();
    await sb.from("strava_states").delete().lt("created_at", new Date(Date.now() - 3600e3).toISOString());
    await sb.from("strava_states").insert({ nonce, user_id: user.id, return_url: ret });
    const q = new URLSearchParams({
      client_id: env("STRAVA_CLIENT_ID"), redirect_uri: `${fnUrl()}?action=callback`, response_type: "code",
      approval_prompt: "auto", scope: "read,activity:read_all,profile:read_all,activity:write", state: nonce,
    });
    return json({ url: `${OAUTH}/mobile/authorize?${q}` });
  }
  if (action === "sync") return json(await syncUser(user.id));
  if (action === "describe") {
    const t = await tokenFor(user.id);
    if (!t || !String(t.scope ?? "").includes("activity:write")) return json({ ok: false });
    const id = Number(body.id), text = String(body.text ?? "").slice(0, 400);
    const r = await get(t.access_token, `/activities/${id}`);
    if (!r.ok) return json({ ok: false });
    const a = await r.json();
    const cur = String(a.description ?? "");
    if (cur.includes("Zone5")) return json({ ok: true, skipped: true });
    const u = await fetch(`${API}/activities/${id}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${t.access_token}`, "content-type": "application/json" },
      body: JSON.stringify({ description: (cur ? cur + "\n\n" : "") + text }),
    });
    return json({ ok: u.ok });
  }
  if (action === "disconnect") {
    const t = await tokenFor(user.id);
    if (t) await fetch(`${OAUTH}/deauthorize`, { method: "POST", headers: { Authorization: `Bearer ${t.access_token}` } }).catch(() => {});
    await sb.from("strava_tokens").delete().eq("user_id", user.id);
    await sb.from("strava_link").delete().eq("user_id", user.id);
    await sb.from("strava_activities").delete().eq("user_id", user.id).eq("processed", false);
    return json({ ok: true });
  }
  return json({ error: "unknown action" }, 400);
});
