// Kontaktní formulář a žádost o eRecept → e-mail ordinaci (odpověď jde rovnou pacientovi).
import { route, body, fail, clean, cleanText, email, phone, ip, limit } from "./_lib/http.js";
import { send, rows, esc, clinicEmail } from "./_lib/mail.js";
import { DOCTORS } from "./_lib/schedule.js";
import { isDate, today } from "./_lib/time.js";

async function common(req) {
  const b = body(req);
  if (b.website) fail(400, "Formulář se nepodařilo odeslat.");
  await limit(`form:${ip(req)}`, 6, 3600);
  if (!b.consent) fail(400, "Potvrďte prosím souhlas se zpracováním údajů.");
  if (!clinicEmail()) fail(503, "Formulář zatím není napojený. Napište nám prosím na info@ortopediekrnov.cz.");
  const name = clean(b.name, 80);
  if (name.length < 3) fail(400, "Vyplňte prosím jméno.");
  return { b, name };
}

async function deliver(opts) {
  if (!(await send(opts))) fail(502, "Zprávu se nepodařilo odeslat. Zavolejte nám prosím na 554 611 766.");
  return { ok: true };
}

export default route({
  "POST contact": async (req) => {
    const { b, name } = await common(req);
    const mail = email(b.email);
    const tel = b.phone ? phone(b.phone) : "";
    const msg = cleanText(b.message, 2000);
    if (msg.length < 5) fail(400, "Napište prosím zprávu.");
    return deliver({
      to: clinicEmail(),
      replyTo: mail,
      subject: `Zpráva z webu: ${name}`,
      html: `<h2 style="margin:6px 0 4px;font-size:20px;color:#122870">Zpráva z webu</h2>
${rows([["Jméno", esc(name)], ["E-mail", esc(mail)], ["Telefon", esc(tel)]])}
<p style="white-space:pre-wrap">${esc(msg)}</p><p style="color:#6b7588;font-size:13px">Odpovědět můžete přímo na tento e-mail.</p>`,
    });
  },

  "POST erecept": async (req) => {
    const { b, name } = await common(req);
    const birth = clean(b.birth, 10);
    if (!isDate(birth) || birth > today()) fail(400, "Zkontrolujte prosím datum narození.");
    const tel = phone(b.phone);
    const mail = email(b.email, false);
    const drug = clean(b.drug, 200);
    if (drug.length < 3) fail(400, "Napište prosím název léku a dávkování.");
    const doctor = DOCTORS[b.doctor] || "";
    return deliver({
      to: clinicEmail(),
      replyTo: mail || undefined,
      subject: `Žádost o eRecept: ${name}`,
      html: `<h2 style="margin:6px 0 4px;font-size:20px;color:#122870">Žádost o eRecept</h2>
${rows([
  ["Pacient", `<strong>${esc(name)}</strong>`],
  ["Narozen/a", esc(birth.split("-").reverse().join(". "))],
  ["Telefon", esc(tel)],
  ["E-mail", esc(mail)],
  ["Lék a dávkování", `<strong>${esc(drug)}</strong>`],
  ["Ošetřující lékař", esc(doctor)],
  ["Poznámka", esc(cleanText(b.note, 1000))],
])}
<p style="color:#6b7588;font-size:13px">eRecept se pacientovi posílá SMS na uvedené číslo.</p>`,
    });
  },
});
