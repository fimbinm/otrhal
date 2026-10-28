// Denní úloha (Vercel Cron): připomínka e-mailem pacientům, kteří mají termín zítra.
import { listRange } from "./_lib/bookings.js";
import { notifyReminder } from "./_lib/mail.js";
import { redis } from "./_lib/redis.js";
import { today, addDays } from "./_lib/time.js";
import { same } from "./_lib/http.js";

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  const ok = secret ? same(req.headers.authorization, `Bearer ${secret}`) : /vercel-cron/i.test(req.headers["user-agent"] || "");
  if (!ok) return res.status(401).json({ error: "Neoprávněný přístup" });

  const base = process.env.SITE_URL ? process.env.SITE_URL.replace(/\/$/, "")
    : `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL || req.headers.host}`;
  const tomorrow = addDays(today(), 1);
  const list = (await listRange(tomorrow, tomorrow)).filter((b) => b.status === "active" && b.email);
  let sent = 0;
  for (const b of list) {
    // každému jen jednou, i kdyby se úloha spustila víckrát
    const first = await redis("SET", `rem:${b.id}`, "1", "NX", "EX", 3 * 86400);
    if (first && (await notifyReminder(b, base))) sent++;
  }
  res.status(200).json({ ok: true, date: tomorrow, candidates: list.length, sent });
}
