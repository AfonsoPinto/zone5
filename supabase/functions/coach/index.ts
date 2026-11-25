// Zone5 · treinador IA (Google Gemini, plano gratuito)
// Recebe o contexto do plano e de uma prova e devolve recomendações em texto.
// Segredos (Edge Functions → Secrets): GEMINI_API_KEY (obrigatório), GEMINI_MODEL (opcional).
// Limite: 8 análises por pessoa por dia (tabela ai_usage).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...CORS, "content-type": "application/json" } });
const DAILY_LIMIT = 8;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: u } = await admin.auth.getUser(token);
  const user = u?.user;
  if (!user) return json({ error: "auth" }, 401);

  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) return json({ error: "not configured" }, 503);

  // limite diário por pessoa
  const day = new Date().toISOString().slice(0, 10);
  const { data: use } = await admin.from("ai_usage").select("n").eq("user_id", user.id).eq("day", day).maybeSingle();
  if ((use?.n ?? 0) >= DAILY_LIMIT) return json({ error: "limit" }, 429);

  let body: { kind?: string; ctx?: Record<string, unknown> };
  try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }
  const ctx = body.ctx ?? {};
  const ctxStr = JSON.stringify(ctx).slice(0, 12000);
  const en = (ctx as { lang?: string }).lang === "en";

  const system = en
    ? `You are an experienced running and HYROX coach inside the Zone5 app. The app's own training engine already built the plan; you do NOT rewrite it. Using the JSON context (athlete, recent workouts, upcoming weeks, this race and other races), give practical, specific advice for THIS race: 1) realistic target time and pacing strategy, 2) how the next weeks should feel and what to watch (key sessions, volume, fatigue signals from RPE), 3) taper, race-week and race-day tips (fuel, warm-up, shoes), 4) recovery after and how it fits the other races. Be honest if the race is too close to another or the target looks unrealistic. Write in British English, friendly and direct, max 170 words, short bullet points with "- ", no headings, no medical claims.`
    : `És um treinador experiente de corrida e HYROX dentro da app Zone5. O motor de treino da app já montou o plano; NÃO o reescreves. Com o contexto em JSON (atleta, treinos recentes, próximas semanas, esta prova e as outras provas), dá conselhos práticos e concretos para ESTA prova: 1) tempo-objetivo realista e estratégia de ritmo, 2) como devem correr as próximas semanas e a que estar atento (sessões-chave, volume, sinais de cansaço pelo esforço/RPE), 3) afinação, semana da prova e dia da prova (alimentação, aquecimento, sapatilhas), 4) recuperação depois e como encaixa com as outras provas. Sê honesto se a prova estiver demasiado perto de outra ou se o objetivo parecer irrealista. Escreve em português de Portugal (tu, nunca você), simpático e direto, no máximo 170 palavras, tópicos curtos começados por "- ", sem títulos, sem conselhos médicos.`;

  const models = [Deno.env.get("GEMINI_MODEL"), "gemini-flash-latest", "gemini-2.5-flash"].filter(Boolean) as string[];
  let text = "", lastErr = "";
  for (const m of models) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${key}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts: [{ text: ctxStr }] }],
          generationConfig: { temperature: 0.6, maxOutputTokens: 4096 },
        }),
      });
      const j = await r.json();
      if (!r.ok) { lastErr = `${m}: ${r.status} ${j?.error?.message ?? ""}`; if (r.status === 429) return json({ error: "limit" }, 429); continue; }
      text = (j?.candidates?.[0]?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? "").join("").trim();
      if (text) break;
    } catch (e) { lastErr = String(e); }
  }
  if (!text) return json({ error: "ai: " + lastErr.slice(0, 200) }, 502);

  await admin.from("ai_usage").upsert({ user_id: user.id, day, n: (use?.n ?? 0) + 1 });
  return json({ text });
});
