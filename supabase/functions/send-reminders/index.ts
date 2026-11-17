// Zone5 · notificações push (chamado de hora a hora pelo cron do Supabase):
//  1) lembrete do treino do dia, à hora escolhida;
//  2) resumo semanal ao domingo às 19h;
//  3) aviso de kudos novos (reações dos amigos), entre as 9h e as 22h.
// Segredos necessários (Edge Functions → Secrets): VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, CRON_SECRET.
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

type Sub = {
  id: string; user_id: string; endpoint: string; p256dh: string; auth: string;
  tz: string | null; hour: number; schedule: Record<string, { title: string; body: string }> | null;
  last_sent: string | null; weekly?: { lang?: string; next?: string; goal?: string } | null;
  last_weekly?: string | null; kudos_seen?: string | null;
};

Deno.serve(async (req) => {
  if (req.headers.get("x-cron-secret") !== Deno.env.get("CRON_SECRET")) {
    return new Response("forbidden", { status: 403 });
  }
  webpush.setVapidDetails(
    Deno.env.get("VAPID_SUBJECT")!,
    Deno.env.get("VAPID_PUBLIC_KEY")!,
    Deno.env.get("VAPID_PRIVATE_KEY")!,
  );
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: subs, error } = await sb.from("push_subs").select("*");
  if (error) return new Response(error.message, { status: 500 });

  let sent = 0, skipped = 0;
  const now = new Date();
  const send = async (s: Sub, title: string, body: string, url: string, tag: string) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify({ title, body, url, date: tag }),
      );
      sent++;
      return true;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await sb.from("push_subs").delete().eq("id", s.id);
      return false;
    }
  };

  for (const s of (subs ?? []) as Sub[]) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: s.tz || "Europe/Lisbon", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", hour12: false, weekday: "short",
    }).formatToParts(now);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    const today = `${get("year")}-${get("month")}-${get("day")}`;
    const hour = Number(get("hour")) % 24;
    const sunday = get("weekday") === "Sun";
    const en = s.weekly?.lang === "en";

    // 1) lembrete do treino do dia
    const msg = s.schedule?.[today];
    if (hour === s.hour && s.last_sent !== today && msg) {
      if (await send(s, msg.title, msg.body, "./#hoje", today)) {
        await sb.from("push_subs").update({ last_sent: today }).eq("id", s.id);
      }
    } else skipped++;

    // 2) resumo semanal (domingo, 19h)
    if (s.weekly && sunday && hour === 19 && s.last_weekly !== today) {
      const d = new Date(`${today}T12:00:00Z`);
      d.setUTCDate(d.getUTCDate() - 6);
      const monday = d.toISOString().slice(0, 10);
      const { data: ws } = await sb.from("weekly_stats").select("km,runs,planned,streak")
        .eq("user_id", s.user_id).eq("week_start", monday).maybeSingle();
      const done = ws?.runs ?? 0, planned = ws?.planned ?? 0, km = Number(ws?.km ?? 0), streak = ws?.streak ?? 0;
      const pct = planned ? done / planned : 0;
      const title = pct >= 0.99
        ? (en ? "Week complete 🎉" : "Semana completa 🎉")
        : pct >= 0.75 ? (en ? "Great week 💪" : "Boa semana 💪")
        : done > 0 ? (en ? "Your week" : "A tua semana") : (en ? "New week, fresh start" : "Nova semana, recomeço");
      const bits = [
        planned ? (en ? `${done}/${planned} workouts` : `${done}/${planned} treinos`) : "",
        km > 0 ? `${km.toLocaleString(en ? "en" : "pt-PT", { maximumFractionDigits: 1 })} km` : "",
        streak >= 2 ? (en ? `🔥 ${streak} weeks in a row` : `🔥 ${streak} semanas seguidas`) : "",
      ].filter(Boolean).join(" · ");
      const body = [bits, s.weekly.next, s.weekly.goal].filter(Boolean).join("\n");
      if (await send(s, title, body || (en ? "See your week in Zone5." : "Vê a tua semana na Zone5."), "./#progresso", "weekly-" + today)) {
        await sb.from("push_subs").update({ last_weekly: today }).eq("id", s.id);
      }
    }

    // 3) kudos novos (só com o resumo ligado, entre as 9h e as 22h)
    if (s.weekly && hour >= 9 && hour <= 22) {
      const seen = s.kudos_seen ?? new Date(0).toISOString();
      const { data: acts } = await sb.from("activities").select("id,title").eq("user_id", s.user_id)
        .gte("date", new Date(Date.now() - 21 * 864e5).toISOString().slice(0, 10));
      const ids = (acts ?? []).map((a) => a.id);
      if (ids.length) {
        const { data: ks } = await sb.from("kudos").select("activity_id,user_id,emoji,created_at")
          .in("activity_id", ids).gt("created_at", seen).neq("user_id", s.user_id).order("created_at");
        if (ks && ks.length) {
          const { data: names } = await sb.from("group_members").select("user_id,display_name")
            .in("user_id", [...new Set(ks.map((k) => k.user_id))]);
          const nm = (id: string) => names?.find((n) => n.user_id === id)?.display_name ?? "?";
          const who = [...new Set(ks.map((k) => `${nm(k.user_id)} ${k.emoji}`))].slice(0, 3).join(", ");
          const act = acts!.find((a) => a.id === ks[ks.length - 1].activity_id)?.title ?? "";
          const title = ks.length === 1
            ? (en ? `${who} on your workout` : `${who} no teu treino`)
            : (en ? `${ks.length} new reactions` : `${ks.length} reações novas`);
          await send(s, title, ks.length === 1 ? act : `${who}${act ? " · " + act : ""}`, "./#grupo", "kudos-" + today);
          await sb.from("push_subs").update({ kudos_seen: ks[ks.length - 1].created_at }).eq("user_id", s.user_id);
        }
      }
    }
  }
  return new Response(JSON.stringify({ sent, skipped }), { headers: { "content-type": "application/json" } });
});
