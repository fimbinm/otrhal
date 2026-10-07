// Rezervace v Redisu.
//   r:{id}     JSON rezervace (id je zároveň tajný odkaz pro zrušení)
//   t:{date}   obsazené časy dne – SADD je atomické, takže jeden čas nejde zabrat dvakrát
//   p:{date}   telefony objednané na daný den (jedna online rezervace na den)
//   d:{date}   id všech rezervací dne (pro administraci a kalendář)
//   closed     hash datum → poznámka (dny, kdy se neordinuje)
// Osobní údaje se po termínu samy smažou (KEEP_DAYS).
import { redis, pipeline, getJSON, mgetJSON } from "./redis.js";
import { id as newId, fail } from "./http.js";
import { DOCTORS, blockFor, slotsFor, startTs, endTs, tooLate, bookableDates } from "./schedule.js";
import { today, addDays, isDate } from "./time.js";
import { notifyBooked, notifyCancelled } from "./mail.js";

const KEEP_DAYS = 60;
const ttl = (date) => Math.max(3600, Math.round((startTs(date, "0:00") - Date.now()) / 1000) + KEEP_DAYS * 86400);

export async function closures() {
  const all = (await redis("HGETALL", "closed")) || [];
  const out = {};
  for (let i = 0; i < all.length; i += 2) out[all[i]] = all[i + 1];
  return out;
}

export async function availability() {
  const dates = bookableDates();
  const [closed, ...taken] = await Promise.all([closures(), ...dates.map((d) => redis("SMEMBERS", `t:${d}`))]);
  return dates.map((date, i) => {
    const b = blockFor(date);
    const busy = new Set(taken[i] || []);
    const slots = slotsFor(date).map((t) => ({ t, free: !busy.has(t) && !tooLate(date, t), busy: busy.has(t) }));
    return {
      date,
      doctor: DOCTORS[b.doctor],
      from: b.from, to: b.to,
      closed: date in closed ? closed[date] || "Neordinuje se" : null,
      slots: date in closed ? [] : slots,
    };
  });
}

export async function create(input, { manual = false, base = "" } = {}) {
  const { date, time } = input;
  if (!isDate(date) || !slotsFor(date).includes(time)) fail(400, "Tento termín nelze rezervovat.");
  if (!manual) {
    if (!bookableDates().includes(date)) fail(400, "Na tento den se zatím nelze objednat.");
    if (tooLate(date, time)) fail(400, "Na tento čas už se online objednat nelze. Zavolejte nám prosím.");
  } else if (date < today()) fail(400, "Termín je v minulosti.");
  if (date in (await closures())) fail(409, "V tento den se neordinuje. Vyberte prosím jiný den.");

  const life = ttl(date);
  if (!manual && input.phone) {
    const fresh = await redis("SADD", `p:${date}`, input.phone);
    if (!fresh) fail(409, "Na tento den už máte rezervaci. Pro změnu termínu ji prosím nejdřív zrušte.");
  }
  const got = await redis("SADD", `t:${date}`, time);
  if (!got) {
    if (!manual && input.phone) await redis("SREM", `p:${date}`, input.phone);
    fail(409, "Tento čas si mezitím rezervoval někdo jiný. Vyberte prosím jiný.");
  }

  const b = blockFor(date);
  const booking = {
    id: newId(),
    date, time,
    doctorId: b.doctor,
    doctor: DOCTORS[b.doctor],
    start: startTs(date, time),
    end: endTs(date, time),
    name: input.name,
    birth: input.birth || "",
    phone: input.phone || "",
    email: input.email || "",
    insurer: input.insurer || "",
    type: input.type || "",
    note: input.note || "",
    source: manual ? "ordinace" : "web",
    status: "active",
    seq: 0,
    createdAt: new Date().toISOString(),
  };
  await pipeline([
    ["SET", `r:${booking.id}`, JSON.stringify(booking), "EX", life],
    ["SADD", `d:${date}`, booking.id],
    ["EXPIRE", `d:${date}`, life],
    ["EXPIRE", `t:${date}`, life],
    ["EXPIRE", `p:${date}`, life],
  ]);
  await notifyBooked(booking, base);
  return booking;
}

export const get = (id) => (/^[\w-]{10,40}$/.test(String(id || "")) ? getJSON(`r:${id}`) : null);

export async function cancel(id, { by = "pacient", notifyPatient = true } = {}) {
  const b = await get(id);
  if (!b) fail(404, "Rezervace nebyla nalezena. Možná už proběhla nebo byla smazána.");
  if (b.status === "cancelled") return b;
  if (by === "pacient" && b.start < Date.now()) fail(400, "Termín už proběhl.");
  b.status = "cancelled";
  b.cancelledBy = by;
  b.cancelledAt = new Date().toISOString();
  b.seq = (b.seq || 0) + 1;
  await pipeline([
    ["SET", `r:${b.id}`, JSON.stringify(b), "KEEPTTL"],
    ["SREM", `t:${b.date}`, b.time],
    ...(b.phone ? [["SREM", `p:${b.date}`, b.phone]] : []),
  ]);
  await notifyCancelled(b, { notifyPatient });
  return b;
}

export async function listRange(from, to) {
  const dates = [];
  for (let d = from; d <= to && dates.length < 120; d = addDays(d, 1)) dates.push(d);
  const ids = await Promise.all(dates.map((d) => redis("SMEMBERS", `d:${d}`)));
  const all = await mgetJSON(ids.flat().map((i) => `r:${i}`));
  return all.filter(Boolean).sort((a, b) => a.start - b.start);
}

export async function setClosed(date, note) {
  if (!isDate(date)) fail(400, "Neplatné datum.");
  await redis("HSET", "closed", date, note || "");
}

export async function unsetClosed(date) {
  await redis("HDEL", "closed", date);
}

// staré zavřené dny se z přehledu průběžně uklízí
export async function pruneClosures() {
  const c = await closures();
  const old = Object.keys(c).filter((d) => d < addDays(today(), -7));
  if (old.length) await redis("HDEL", "closed", ...old);
}

