// Zone5 · envia o lembrete do treino do dia (chamado de hora a hora pelo cron do Supabase).
// Segredos necessários (Edge Functions → Secrets): VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, CRON_SECRET.
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

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
  for (const s of subs ?? []) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: s.tz || "Europe/Lisbon", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hour12: false,
    }).formatToParts(now);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    const today = `${get("year")}-${get("month")}-${get("day")}`;
    const hour = Number(get("hour")) % 24;
    const msg = s.schedule?.[today];
    if (hour !== s.hour || s.last_sent === today || !msg) { skipped++; continue; }
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify({ title: msg.title, body: msg.body, url: "./#hoje" }),
      );
      sent++;
      await sb.from("push_subs").update({ last_sent: today }).eq("id", s.id);
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await sb.from("push_subs").delete().eq("id", s.id);
    }
  }
  return new Response(JSON.stringify({ sent, skipped }), { headers: { "content-type": "application/json" } });
});
