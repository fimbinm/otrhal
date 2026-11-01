// Čtení Google Kalendáře ordinace přes tajnou adresu iCal (GCAL_ICS_URL).
// Událost zapsaná přímo v kalendáři zabere na webu daný čas. Ukládají se jen časy, ne jména pacientů.
import { getJSON, setJSON } from "./redis.js";
import { parts, toTs, addDays, weekday } from "./time.js";
import { slotsFor, startTs, endTs, HORIZON_DAYS } from "./schedule.js";

const CACHE_MS = 30000;
const SHORT_MS = 15 * 60000; // událost do 15 minut zabere jen termín, ve kterém začíná
const OWN_UID = /@ortopediekrnov\.cz$/i; // rezervace z webu hlídá web sám
const DAY_NAMES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const MAX_STEPS = 5000;

function readProps(block) {
  const out = [];
  for (const line of block) {
    const i = line.indexOf(":");
    if (i < 0) continue;
    const [name, ...params] = line.slice(0, i).split(";");
    out.push({ name: name.toUpperCase(), params: params.join(";").toUpperCase(), value: line.slice(i + 1) });
  }
  return out;
}

// DTSTART, DTEND, EXDATE… → začátek v ms a pražské datum + minuty
function readTime(value, params) {
  const m = String(value).trim().match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
  if (!m) return null;
  const date = `${m[1]}-${m[2]}-${m[3]}`;
  if (!m[4] || /VALUE=DATE(?!-)/.test(params || "")) return { allDay: true, date, minutes: 0, ts: toTs(date, 0) };
  const minutes = +m[4] * 60 + +m[5];
  if (m[7]) {
    const ts = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
    const p = parts(ts);
    return { allDay: false, date: p.date, minutes: p.minutes, ts };
  }
  return { allDay: false, date, minutes, ts: toTs(date, minutes) };
}

function readDuration(value) {
  const m = String(value || "").match(/^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!m) return null;
  return ((+m[1] || 0) * 7 * 86400 + (+m[2] || 0) * 86400 + (+m[3] || 0) * 3600 + (+m[4] || 0) * 60 + (+m[5] || 0)) * 1000;
}

// začátky opakované události (denní a týdenní opakování)
function expand(start, rule, untilLimit, fromLimit) {
  const r = Object.fromEntries(rule.split(";").map((x) => x.split("=")));
  const every = Math.max(1, Number(r.INTERVAL) || 1);
  const count = Number(r.COUNT) || Infinity;
  const until = r.UNTIL ? (readTime(r.UNTIL) || {}).ts ?? Infinity : Infinity;
  if (r.FREQ !== "DAILY" && r.FREQ !== "WEEKLY") {
    console.warn("gcal: nepodporované opakování", r.FREQ);
    return [];
  }
  const out = [];
  let seen = 0;
  const push = (date) => {
    const ts = start.allDay ? toTs(date, 0) : toTs(date, start.minutes);
    if (ts < start.ts) return true;
    if (ts > until || seen >= count || ts > untilLimit) return false;
    seen++;
    if (ts >= fromLimit) out.push(ts);
    return true;
  };
  if (r.FREQ === "DAILY") {
    let d = start.date;
    for (let i = 0; i < MAX_STEPS; i++, d = addDays(d, every)) if (!push(d)) break;
    return out;
  }
  const days = (r.BYDAY ? r.BYDAY.split(",") : [DAY_NAMES[weekday(start.date)]])
    .map((x) => (DAY_NAMES.indexOf(x.slice(-2)) + 6) % 7).sort((a, b) => a - b); // 0 = pondělí
  let monday = addDays(start.date, -((weekday(start.date) + 6) % 7));
  for (let i = 0; i < MAX_STEPS; i++, monday = addDays(monday, every * 7)) {
    for (const off of days) if (!push(addDays(monday, off))) return out;
  }
  return out;
}

// text .ics → seznam obsazených úseků {s, e, day} v daném období
export function parseIcs(text, from, to) {
  const lines = String(text).replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
  const events = [];
  let cur = null;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") cur = [];
    else if (line === "END:VEVENT") { if (cur) events.push(readProps(cur)); cur = null; }
    else if (cur) cur.push(line);
  }

  // úpravy a smazání jednoho výskytu opakované události
  const moved = new Set();
  const get = (e, n) => e.find((p) => p.name === n);
  for (const e of events) {
    const rid = get(e, "RECURRENCE-ID");
    const uid = get(e, "UID");
    if (!rid || !uid) continue;
    const t = readTime(rid.value, rid.params);
    if (t) moved.add(`${uid.value}|${t.ts}`);
  }

  const out = [];
  for (const e of events) {
    const uid = (get(e, "UID") || {}).value || "";
    if (OWN_UID.test(uid)) continue;
    if ((get(e, "STATUS") || {}).value?.trim().toUpperCase() === "CANCELLED") continue;
    if ((get(e, "TRANSP") || {}).value?.trim().toUpperCase() === "TRANSPARENT") continue; // událost označená jako „Volno“
    const sp = get(e, "DTSTART");
    if (!sp) continue;
    const start = readTime(sp.value, sp.params);
    if (!start) continue;
    const ep = get(e, "DTEND");
    const end = ep ? readTime(ep.value, ep.params) : null;
    const dur = get(e, "DURATION") ? readDuration(get(e, "DURATION").value) : null;
    const length = end ? end.ts - start.ts : dur ?? (start.allDay ? 86400000 : 0);

    const skip = new Set();
    for (const x of e.filter((p) => p.name === "EXDATE")) {
      for (const v of x.value.split(",")) {
        const t = readTime(v, x.params);
        if (t) skip.add(t.ts);
      }
    }
    const rule = get(e, "RRULE");
    const starts = rule ? expand(start, rule.value, to, from - length) : [start.ts];
    for (const s of starts) {
      if (skip.has(s) || (rule && moved.has(`${uid}|${s}`))) continue;
      if (s + length < from || s > to) continue;
      out.push({ s, e: s + length, day: start.allDay });
    }
  }
  return out;
}

// časy daného dne, které události zabírají
export function busyTimes(occ, date) {
  const slots = slotsFor(date).map((t) => ({ t, s: startTs(date, t), e: endTs(date, t) }));
  const busy = new Set();
  for (const o of occ) {
    const inside = slots.find((x) => o.s >= x.s && o.s < x.e);
    if (!o.day && o.e - o.s <= SHORT_MS && inside) { busy.add(inside.t); continue; }
    for (const x of slots) if (o.s < x.e && (o.e > x.s || (o.e === o.s && o.s >= x.s))) busy.add(x.t);
  }
  return busy;
}

let cache = { at: 0, occ: [] };
let status = { configured: false, ok: null };
export const gcalStatus = () => ({ ...status, configured: Boolean(process.env.GCAL_ICS_URL) });

export async function occurrences() {
  const url = process.env.GCAL_ICS_URL;
  if (!url) return [];
  if (Date.now() - cache.at < CACHE_MS) return cache.occ;
  const now = Date.now();
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(4000), headers: { "User-Agent": "ortohal-web" } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const text = await r.text();
    if (!text.includes("BEGIN:VCALENDAR")) throw new Error("odpověď není kalendář");
    const occ = parseIcs(text, now - 86400000, now + (HORIZON_DAYS + 7) * 86400000);
    cache = { at: now, occ };
    status = { ok: true };
    await setJSON("gcal:last", occ).catch(() => {});
    return occ;
  } catch (err) {
    // adresu nelogujeme, je tajná
    console.error("gcal:", err.name, String(err.message).replace(/https?:\S+/g, "[url]"));
    status = { ok: false };
    if (!cache.at) cache.occ = (await getJSON("gcal:last").catch(() => null)) || [];
    cache.at = now - CACHE_MS + 10000; // zkusit znovu za 10 s
    return cache.occ;
  }
}
