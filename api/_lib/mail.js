// E-maily přes Resend + pozvánky do kalendáře (.ics).
// Ordinace dostane ke každé rezervaci pozvánku (METHOD:REQUEST) – Gmail / Google Kalendář,
// Outlook i Apple ji samy zapíšou do kalendáře; zrušení pošle METHOD:CANCEL se stejným UID.
import { INSURERS } from "./schedule.js";
import { prettyPhone } from "./http.js";

const KEY = process.env.RESEND_API_KEY;
const FROM = process.env.MAIL_FROM || "ORTOHAL Krnov <onboarding@resend.dev>";
export const clinicEmail = () => (process.env.CLINIC_EMAIL || "").trim();
const fromAddr = () => (FROM.match(/<([^>]+)>/) || [, FROM])[1];

const PLACE = "Poliklinika Krnov, Náměstí Hrdinů 8, 794 01 Krnov";
const PHONE = "554 611 766";

export const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export async function send({ to, subject, html, replyTo, attachments }) {
  if (!to) return false;
  if (!KEY) {
    console.log("[mail – chybí RESEND_API_KEY]", to, subject);
    return false;
  }
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: FROM, to: [to], subject, html: layout(html),
      ...(replyTo ? { reply_to: replyTo } : {}),
      ...(attachments ? { attachments } : {}),
    }),
  });
  if (!r.ok) console.error("resend", r.status, await r.text());
  return r.ok;
}

function layout(inner) {
  return `<div style="background:#f3f5f9;padding:24px 12px;font:15px/1.55 Helvetica,Arial,sans-serif;color:#1d2433">
<div style="max-width:560px;margin:0 auto;background:#fff;border-top:4px solid #1B3A8C">
<div style="padding:22px 28px 6px;font:600 13px/1 Helvetica,Arial,sans-serif;letter-spacing:.28em;color:#1B3A8C">ORTOHAL <span style="color:#C0272D">KRNOV</span></div>
<div style="padding:8px 28px 28px">${inner}</div>
<div style="padding:16px 28px;border-top:1px solid #e3e8f1;font-size:12px;color:#6b7588">ORTOHAL s.r.o. · ${PLACE} · tel. ${PHONE}</div>
</div></div>`;
}

export function rows(pairs) {
  return `<table role="presentation" style="width:100%;border-collapse:collapse;margin:14px 0">${pairs
    .filter(([, v]) => v)
    .map(([k, v]) => `<tr><td style="padding:7px 12px 7px 0;border-bottom:1px solid #e3e8f1;color:#6b7588;font-size:13px;white-space:nowrap;vertical-align:top">${esc(k)}</td><td style="padding:7px 0;border-bottom:1px solid #e3e8f1">${v}</td></tr>`)
    .join("")}</table>`;
}

const button = (href, label, color = "#1B3A8C") =>
  `<p style="margin:22px 0 6px"><a href="${esc(href)}" style="display:inline-block;background:${color};color:#fff;text-decoration:none;padding:12px 20px;border-radius:4px;font-weight:600">${esc(label)}</a></p>`;

export function when(b) {
  const d = new Date(b.start).toLocaleDateString("cs-CZ", { timeZone: "Europe/Prague", weekday: "long", day: "numeric", month: "long", year: "numeric" });
  return `${d} v ${b.time}`;
}

/* ---------- ICS ---------- */

const icsText = (s) => String(s ?? "").replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/[,;]/g, (c) => "\\" + c);
const icsTime = (ts) => new Date(ts).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

// řádky delší než 75 bajtů se podle RFC 5545 lámou (bez rozbití znaků UTF-8)
function fold(line) {
  const out = [];
  let cur = "", bytes = 0;
  for (const ch of line) {
    const n = Buffer.byteLength(ch);
    if (bytes + n > (out.length ? 74 : 75)) { out.push(cur); cur = ""; bytes = 0; }
    cur += ch; bytes += n;
  }
  out.push(cur);
  return out.join("\r\n ");
}

export function vevent(b, { forClinic, cancelled = false } = {}) {
  const ins = b.insurer ? `${b.insurer} ${INSURERS[b.insurer] || ""}`.trim() : "";
  const desc = forClinic
    ? [
        `Pacient: ${b.name}`,
        b.birth && `Datum narození: ${b.birth.split("-").reverse().join(". ")}`,
        b.phone && `Telefon: ${prettyPhone(b.phone)}`,
        b.email && `E-mail: ${b.email}`,
        ins && `Pojišťovna: ${ins}`,
        b.type && `Důvod: ${b.type}`,
        b.note && `Poznámka: ${b.note}`,
        `Lékař: ${b.doctor}`,
        `Zdroj: ${b.source === "ordinace" ? "zapsáno v ordinaci" : "online rezervace"}`,
      ].filter(Boolean).join("\n")
    : `Ortopedická ambulance ORTOHAL – ${b.doctor}\nVezměte si prosím kartičku pojišťovny a případné zprávy a snímky.\nZměna nebo zrušení: tel. ${PHONE}`;
  const surname = b.doctor.split(" ").pop();
  const lines = [
    "BEGIN:VEVENT",
    `UID:${b.id}@ortopediekrnov.cz`,
    `SEQUENCE:${b.seq || 0}`,
    `DTSTAMP:${icsTime(Date.now())}`,
    `DTSTART:${icsTime(b.start)}`,
    `DTEND:${icsTime(b.end)}`,
    `SUMMARY:${icsText(forClinic ? `${b.name} – ${b.type || "objednaný"} (${surname})` : `Ortopedie ORTOHAL – ${b.doctor}`)}`,
    `LOCATION:${icsText(PLACE)}`,
    `DESCRIPTION:${icsText(desc)}`,
    `STATUS:${cancelled ? "CANCELLED" : "CONFIRMED"}`,
  ];
  if (forClinic && clinicEmail()) {
    lines.push(`ORGANIZER;CN=ORTOHAL rezervace:mailto:${fromAddr()}`);
    lines.push(`ATTENDEE;CN=Ordinace ORTOHAL;ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;RSVP=FALSE:mailto:${clinicEmail()}`);
  }
  if (!cancelled && !forClinic) lines.push("BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:Návštěva ortopedie", "TRIGGER:-PT2H", "END:VALARM");
  lines.push("END:VEVENT");
  return lines;
}

export function calendar(events, method) {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//ORTOHAL Krnov//Rezervace//CS",
    "CALSCALE:GREGORIAN",
    ...(method ? [`METHOD:${method}`] : []),
    "X-WR-CALNAME:ORTOHAL – objednaní pacienti",
    "X-WR-TIMEZONE:Europe/Prague",
    ...events.flat(),
    "END:VCALENDAR",
  ].map(fold).join("\r\n") + "\r\n";
}

const attach = (ics, method, name = "termin.ics") => [{
  filename: name,
  content: Buffer.from(ics).toString("base64"),
  content_type: `text/calendar; charset=UTF-8; method=${method}`,
}];

/* ---------- zprávy ---------- */

function detailRows(b, forClinic) {
  const ins = b.insurer ? `${b.insurer} ${INSURERS[b.insurer] || ""}` : "";
  return rows([
    ["Termín", `<strong>${esc(when(b))}</strong>`],
    ["Lékař", esc(b.doctor)],
    ...(forClinic
      ? [
          ["Pacient", `<strong>${esc(b.name)}</strong>`],
          ["Narozen/a", esc(b.birth && b.birth.split("-").reverse().join(". "))],
          ["Telefon", b.phone && `<a href="tel:${esc(b.phone)}">${esc(prettyPhone(b.phone))}</a>`],
          ["E-mail", b.email && `<a href="mailto:${esc(b.email)}">${esc(b.email)}</a>`],
          ["Pojišťovna", esc(ins)],
          ["Důvod", esc(b.type)],
          ["Poznámka", esc(b.note)],
        ]
      : [["Kde", esc(PLACE)], ["Důvod", esc(b.type)]]),
  ]);
}

export async function notifyBooked(b, base) {
  const clinic = clinicEmail();
  const jobs = [];
  if (clinic) {
    jobs.push(send({
      to: clinic,
      replyTo: b.email || undefined,
      subject: `Nová rezervace: ${b.name} – ${when(b)}`,
      html: `<h2 style="margin:6px 0 4px;font-size:20px;color:#122870">Nová rezervace</h2>
<p style="margin:0;color:#6b7588">${b.source === "ordinace" ? "Zapsáno v administraci." : "Pacient se objednal přes web."} Termín je v příloze jako pozvánka do kalendáře.</p>
${detailRows(b, true)}${button(`${base}/admin`, "Otevřít přehled rezervací")}`,
      attachments: attach(calendar([vevent(b, { forClinic: true })], "REQUEST"), "REQUEST", "rezervace.ics"),
    }));
  }
  if (b.email) {
    jobs.push(send({
      to: b.email,
      replyTo: clinic || undefined,
      subject: `Potvrzení termínu – ORTOHAL Krnov, ${when(b)}`,
      html: `<h2 style="margin:6px 0 4px;font-size:20px;color:#122870">Termín máte rezervovaný</h2>
<p style="margin:0">Dobrý den, děkujeme za objednání. Těšíme se na Vás.</p>
${detailRows(b, false)}
<p style="font-size:14px;color:#3d4659">Přijďte prosím 5 minut předem a vezměte si kartičku pojišťovny, případné lékařské zprávy a snímky. Objednaní pacienti mají přednost, akutní stavy však lékař ošetří vždy přednostně, proto se čas může mírně posunout.</p>
<p style="font-size:14px;color:#3d4659">Termín si můžete přidat do kalendáře z přílohy.</p>
${button(`${base}/zruseni?id=${encodeURIComponent(b.id)}`, "Nemůžu přijít – zrušit termín", "#C0272D")}`,
      attachments: attach(calendar([vevent(b, { forClinic: false })], "PUBLISH"), "PUBLISH"),
    }));
  }
  await Promise.allSettled(jobs);
}

export async function notifyCancelled(b, { notifyPatient = true } = {}) {
  const clinic = clinicEmail();
  const jobs = [];
  if (clinic) {
    jobs.push(send({
      to: clinic,
      subject: `Zrušeno: ${b.name} – ${when(b)}`,
      html: `<h2 style="margin:6px 0 4px;font-size:20px;color:#C0272D">Rezervace zrušena</h2>
<p style="margin:0;color:#6b7588">Zrušil(a): ${b.cancelledBy === "pacient" ? "pacient přes odkaz v e-mailu" : "ordinace v administraci"}. Termín je znovu volný a z kalendáře zmizí.</p>
${detailRows(b, true)}`,
      attachments: attach(calendar([vevent(b, { forClinic: true, cancelled: true })], "CANCEL"), "CANCEL", "zruseni.ics"),
    }));
  }
  if (b.email && notifyPatient) {
    jobs.push(send({
      to: b.email,
      replyTo: clinic || undefined,
      subject: `Termín zrušen – ORTOHAL Krnov, ${when(b)}`,
      html: `<h2 style="margin:6px 0 4px;font-size:20px;color:#122870">Termín je zrušený</h2>
<p style="margin:0">${b.cancelledBy === "pacient"
        ? "Potvrzujeme zrušení Vašeho termínu."
        : "Omlouváme se, Váš termín musela ordinace zrušit. Objednejte se prosím na jiný den nebo nám zavolejte."}</p>
${detailRows(b, false)}`,
    }));
  }
  await Promise.allSettled(jobs);
}
