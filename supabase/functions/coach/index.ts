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

  const kind = ["review", "workout", "plan"].includes(body.kind ?? "") ? body.kind as string : "race";
  const base = en
    ? `You are an experienced coach for running, HYROX and strength training inside the Zone5 app. The app's own training engine builds and adapts the plan; you do NOT rewrite it, you advise. Use only the JSON context (athlete, recent workouts, lifts, upcoming weeks, races). Be specific with numbers (paces, times, kg, reps) when the data supports it, honest when something looks off, and never give medical advice. Write in British English, friendly and direct, max 170 words (unless the task says otherwise), short bullet points starting with "- ", no headings.`
    : `És um treinador experiente de corrida, HYROX e treino de força dentro da app Zone5. O motor da app monta e adapta o plano; tu NÃO o reescreves, aconselhas. Usa só o contexto em JSON (atleta, treinos recentes, exercícios de ginásio, próximas semanas, provas). Sê concreto com números (ritmos, tempos, kg, repetições) quando os dados o permitirem, honesto quando algo não bate certo, e nunca dês conselhos médicos. Escreve em português de Portugal (tu, nunca você), simpático e direto, no máximo 170 palavras (salvo indicação na tarefa), tópicos curtos começados por "- ", sem títulos.`;
  const task = {
    race: en
      ? `Task: advice for THIS race (running or HYROX): realistic target and pacing (for HYROX also running pace between stations and which stations to manage), how the coming weeks should go and key sessions, taper/race-week/race-day tips, recovery after and how it fits other races. Flag races too close together.`
      : `Tarefa: conselhos para ESTA prova (corrida ou HYROX): objetivo realista e estratégia de ritmo (no HYROX, também o ritmo da corrida entre estações e que estações gerir), como devem correr as próximas semanas e as sessões-chave, afinação, semana e dia da prova, recuperação depois e como encaixa com as outras provas. Avisa se houver provas demasiado juntas.`,
    review: en
      ? `Task: review the athlete's recent training across all their sports (running, gym, HYROX): 2 things going well, 2–3 things to improve (e.g. too fast on easy days, stalled lifts, missed sessions, imbalance), and the focus for the next 2 weeks.`
      : `Tarefa: analisa os treinos recentes do atleta em todas as modalidades (corrida, ginásio, HYROX): 2 coisas a correr bem, 2–3 a melhorar (ex.: fáceis demasiado rápidos, exercícios estagnados, treinos falhados, desequilíbrios) e o foco para as próximas 2 semanas.`,
    plan: en
      ? `Task: review the last ~3 weeks against ALL the athlete's goals (main goal, every upcoming race with its priority A/B/C, and side sports like gym/HYROX/running). First write max 120 words of feedback as "- " bullets: what's going well, what worries you (fatigue, missed sessions, paces too fast/slow, stalled lifts, races too close), and the focus now.
Then write a line with exactly ###JSON### followed by ONE JSON object {"proposals":[...]} with 0 to 4 changes to UPCOMING workouts, only if the data justifies them (an empty list is fine). Allowed actions only:
{"action":"lighten","date":"YYYY-MM-DD","why":"..."} lighter version of that workout (any sport);
{"action":"easy","date":"YYYY-MM-DD","why":"..."} turn a quality run into an easy run;
{"action":"rest","date":"YYYY-MM-DD","why":"..."} skip that workout;
{"action":"volume_week","week_start":"YYYY-MM-DD","pct":-30..10,"why":"..."} scale a week's volume;
{"action":"paces","delta":-1.5..1.5,"why":"..."} adjust the fitness index (VDOT) used for all paces;
{"action":"race_prio","race_id":"...","prio":"A|B|C","why":"..."} change a race's priority.
Use only dates/ids from "upcoming" and "goals.races". Keep "why" under 15 words. No text after the JSON.`
      : `Tarefa: analisa as últimas ~3 semanas face a TODOS os objetivos do atleta (objetivo principal, cada prova futura com a prioridade A/B/C, e modalidades extra como ginásio/HYROX/corrida). Primeiro escreve no máximo 120 palavras de feedback em tópicos "- ": o que está a correr bem, o que te preocupa (cansaço, treinos falhados, ritmos rápidos/lentos demais, exercícios estagnados, provas demasiado juntas) e o foco agora.
Depois escreve uma linha exatamente com ###JSON### seguida de UM objeto JSON {"proposals":[...]} com 0 a 4 alterações aos PRÓXIMOS treinos, só se os dados o justificarem (lista vazia é válida). Só estas ações:
{"action":"lighten","date":"AAAA-MM-DD","why":"..."} versão mais leve desse treino (qualquer modalidade);
{"action":"easy","date":"AAAA-MM-DD","why":"..."} trocar um treino de qualidade de corrida por fácil;
{"action":"rest","date":"AAAA-MM-DD","why":"..."} saltar esse treino;
{"action":"volume_week","week_start":"AAAA-MM-DD","pct":-30..10,"why":"..."} ajustar o volume de uma semana;
{"action":"paces","delta":-1.5..1.5,"why":"..."} ajustar o índice de forma (VDOT) usado em todos os ritmos;
{"action":"race_prio","race_id":"...","prio":"A|B|C","why":"..."} mudar a prioridade de uma prova.
Usa só datas/ids que estejam em "upcoming" e "goals.races". "why" com menos de 15 palavras, em português. Nada depois do JSON.`,
    workout: en
      ? `Task: comment on THIS workout compared with what was planned and recent training: what went well, what to adjust next time (pace, effort, weights, reps, recovery). Max 90 words.`
      : `Tarefa: comenta ESTE treino face ao planeado e aos treinos recentes: o que correu bem e o que ajustar no próximo (ritmo, esforço, pesos, repetições, recuperação). Máximo 90 palavras.`,
  }[kind];
  const system = base + "\n" + task;

  const models = [Deno.env.get("GEMINI_MODEL"), "gemini-flash-latest", "gemini-2.5-flash"].filter(Boolean) as string[];
  const payload = (thinking: boolean) => JSON.stringify({
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts: [{ text: ctxStr }] }],
    generationConfig: { temperature: 0.6, maxOutputTokens: 4096, ...(thinking ? { thinkingConfig: { thinkingLevel: "low" } } : {}) },
  });
  // escolhe o primeiro modelo que aceita o pedido (pouco raciocínio = resposta mais rápida)
  let up: Response | null = null, lastErr = "";
  outer: for (const m of models) {
    for (const thinking of [true, false]) {
      try {
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:streamGenerateContent?alt=sse`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": key.trim() },
          body: payload(thinking),
        });
        if (r.ok && r.body) { up = r; break outer; }
        const t = await r.text();
        lastErr = `${m}: ${r.status} ${t.slice(0, 160)}`;
        if (r.status === 429) return json({ error: "limit" }, 429);
        if (r.status === 400 && thinking) continue; // modelo sem "thinkingLevel": tenta sem
        break;
      } catch (e) { lastErr = String(e); break; }
    }
  }
  if (!up) return json({ error: "ai: " + lastErr.slice(0, 200) }, 502);

  await admin.from("ai_usage").upsert({ user_id: user.id, day, n: (use?.n ?? 0) + 1 });

  // reenvia o texto à app à medida que o Gemini o vai escrevendo
  const enc = new TextEncoder(), dec = new TextDecoder();
  const reader = up.body!.getReader();
  const stream = new ReadableStream({
    async start(ctrl) {
      let buf = "";
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let k;
          while ((k = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, k).trim(); buf = buf.slice(k + 1);
            if (!line.startsWith("data:")) continue;
            try {
              const j = JSON.parse(line.slice(5));
              const parts = j?.candidates?.[0]?.content?.parts ?? [];
              const t = parts.filter((p: { thought?: boolean }) => !p.thought).map((p: { text?: string }) => p.text ?? "").join("");
              if (t) ctrl.enqueue(enc.encode(t));
            } catch { /* linha incompleta */ }
          }
        }
      } finally { ctrl.close(); }
    },
  });
  return new Response(stream, { headers: { ...CORS, "content-type": "text/plain; charset=utf-8", "cache-control": "no-cache" } });
});
