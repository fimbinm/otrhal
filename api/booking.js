// Veřejné rezervace: volné termíny, objednání, zrušení, kalendářový odběr pro ordinaci.
import { route, body, fail, clean, cleanText, email, phone, ip, limit, baseUrl, verify } from "./_lib/http.js";
import { availability, create, get, cancel, listRange, closures } from "./_lib/bookings.js";
import { VISIT_TYPES, INSURERS, SLOT_MIN } from "./_lib/schedule.js";
import { calendar, vevent, when } from "./_lib/mail.js";
import { today, addDays, isDate } from "./_lib/time.js";

export default route({
  "GET days": async () => ({ slotMinutes: SLOT_MIN, types: VISIT_TYPES, insurers: INSURERS, days: await availability() }),

  // zavřené dny pro lištu na hlavní stránce
  "GET closed": async () => {
    const c = await closures();
    const t = today();
    return { closed: Object.keys(c).filter((d) => d >= t).sort().map((d) => ({ date: d, note: c[d] })) };
  },

  "POST book": async (req) => {
    const b = body(req);
    if (b.website) fail(400, "Formulář se nepodařilo odeslat."); // past na roboty
    await limit(`book:${ip(req)}`, 8, 3600);
    if (!b.consent) fail(400, "Potvrďte prosím souhlas se zpracováním údajů.");
    const name = clean(b.name, 80);
    if (name.length < 4 || !name.includes(" ")) fail(400, "Vyplňte prosím jméno i příjmení.");
    const birth = clean(b.birth, 10);
    if (!isDate(birth) || birth > today() || birth < "1900-01-01") fail(400, "Zkontrolujte prosím datum narození.");
    const type = VISIT_TYPES.includes(b.type) ? b.type : fail(400, "Vyberte prosím důvod návštěvy.");
    const insurer = b.insurer in INSURERS ? String(b.insurer) : fail(400, "Vyberte prosím zdravotní pojišťovnu.");
    const booking = await create({
      date: clean(b.date, 10),
      time: clean(b.time, 5),
      name, birth, type, insurer,
      phone: phone(b.phone),
      email: email(b.email),
      note: cleanText(b.note, 500),
    }, { base: baseUrl(req) });
    return { ok: true, id: booking.id, when: when(booking), doctor: booking.doctor };
  },

  // stránka /zruseni
  "GET booking": async (req) => {
    const b = await get(req.query.id);
    if (!b) fail(404, "Rezervace nebyla nalezena. Možná už proběhla nebo byla smazána.");
    return { when: when(b), doctor: b.doctor, status: b.status, past: b.start < Date.now() };
  },

  "POST cancel": async (req) => {
    await limit(`cancel:${ip(req)}`, 20, 3600);
    const b = await cancel(body(req).id, { by: "pacient" });
    return { ok: true, when: when(b) };
  },

  // odběr kalendáře (Google / Outlook / Apple) – adresa s tajným klíčem je v administraci
  "GET feed": async (req, res) => {
    if (!(await verify("feed", req.query.k))) fail(403, "Neplatný odkaz.");
    const list = await listRange(addDays(today(), -30), addDays(today(), 90));
    const ics = calendar(list.filter((b) => b.status === "active").map((b) => vevent(b, { forClinic: true })));
    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.status(200).send(ics);
  },
});
