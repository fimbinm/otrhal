// Administrace pro ordinaci: přihlášení heslem (ADMIN_PASSWORD), přehled, ruční zápis, zrušení, zavřené dny.
import { route, body, fail, clean, cleanText, email, phone, ip, limit, baseUrl, sign, verify, same, cookies, setCookie } from "./_lib/http.js";
import { create, cancel, listRange, closures, setClosed, unsetClosed, pruneClosures, availability } from "./_lib/bookings.js";
import { VISIT_TYPES, INSURERS } from "./_lib/schedule.js";
import { clinicEmail } from "./_lib/mail.js";
import { today, addDays, isDate } from "./_lib/time.js";

const COOKIE = "ortohal_admin";
const DAYS = 30;

async function requireAdmin(req) {
  const [exp, sig] = String(cookies(req)[COOKIE] || "").split(".");
  if (!exp || Number(exp) < Date.now() || !(await verify(`admin:${exp}`, sig))) fail(401, "Přihlaste se prosím.");
}

export default route({
  "POST login": async (req, res) => {
    await limit(`login:${ip(req)}`, 10, 900);
    const pass = process.env.ADMIN_PASSWORD;
    if (!pass) fail(503, "Administrace zatím nemá nastavené heslo (ADMIN_PASSWORD).");
    if (!same(body(req).password, pass)) fail(401, "Nesprávné heslo.");
    const exp = String(Date.now() + DAYS * 86400000);
    setCookie(res, COOKIE, `${exp}.${await sign(`admin:${exp}`)}`, DAYS * 86400);
    return { ok: true };
  },

  "POST logout": async (req, res) => {
    setCookie(res, COOKIE, "", 0);
    return { ok: true };
  },

  "GET overview": async (req) => {
    await requireAdmin(req);
    const from = isDate(req.query.from) ? req.query.from : today();
    const to = isDate(req.query.to) ? req.query.to : addDays(from, 13);
    await pruneClosures();
    const [list, closed, days] = await Promise.all([listRange(from, to), closures(), availability()]);
    return {
      from, to,
      bookings: list,
      closed,
      days,
      types: VISIT_TYPES,
      insurers: INSURERS,
      clinicEmail: clinicEmail(),
      feedUrl: `${baseUrl(req)}/api/booking?a=feed&k=${await sign("feed")}`,
      mailReady: Boolean(process.env.RESEND_API_KEY),
    };
  },

  "POST add": async (req) => {
    await requireAdmin(req);
    const b = body(req);
    const name = clean(b.name, 80);
    if (name.length < 3) fail(400, "Vyplňte jméno pacienta.");
    const booking = await create({
      date: clean(b.date, 10),
      time: clean(b.time, 5),
      name,
      birth: isDate(b.birth) ? b.birth : "",
      phone: b.phone ? phone(b.phone) : "",
      email: email(b.email, false),
      insurer: b.insurer in INSURERS ? String(b.insurer) : "",
      type: VISIT_TYPES.includes(b.type) ? b.type : "",
      note: cleanText(b.note, 500),
    }, { manual: true, base: baseUrl(req) });
    return { ok: true, id: booking.id };
  },

  "POST cancel": async (req) => {
    await requireAdmin(req);
    const b = body(req);
    await cancel(b.id, { by: "ordinace", notifyPatient: b.notify !== false });
    return { ok: true };
  },

  "POST close": async (req) => {
    await requireAdmin(req);
    const b = body(req);
    await setClosed(clean(b.date, 10), clean(b.note, 120));
    return { ok: true };
  },

  "POST open": async (req) => {
    await requireAdmin(req);
    await unsetClosed(clean(body(req).date, 10));
    return { ok: true };
  },
});
