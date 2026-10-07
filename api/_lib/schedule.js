// Ordinační hodiny ORTOHAL (platné od 1. 4. 2025).
// Online se objednává jen do bloků „pouze objednaní“; ostatní ordinace jsou bez objednání.
// Při změně hodin stačí upravit tento soubor (a tabulku na webu v index.html).
import { today, addDays, weekday, toTs } from "./time.js";

export const DOCTORS = {
  halir: "MUDr. Miroslav Halíř",
  kocian: "MUDr. Rostislav Kocián",
  zapalac: "MUDr. Karel Zapalač",
};

// weekday: 1 = pondělí … 5 = pátek
export const BLOCKS = [
  { weekday: 1, doctor: "halir", from: "16:00", to: "18:00" },
  { weekday: 2, doctor: "kocian", from: "12:30", to: "15:30" },
];

export const SLOT_MIN = Number(process.env.SLOT_MINUTES) || 10;
export const HORIZON_DAYS = Number(process.env.BOOKING_DAYS_AHEAD) || 42;
export const LEAD_MIN = 60; // online nejpozději hodinu před termínem

export const VISIT_TYPES = [
  "První vyšetření",
  "Kontrolní vyšetření",
  "Rázová vlna",
  "Aplikace injekcí (GUNA, Ortoflex)",
  "Jiné",
];

export const INSURERS = {
  111: "VZP ČR", 201: "VoZP", 205: "ČPZP", 207: "OZP", 209: "ZP Škoda", 211: "ZP MV ČR", 213: "RBP",
};

const min = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
export const hhmm = (m) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;

export function blockFor(date) {
  return BLOCKS.find((b) => b.weekday === weekday(date)) || null;
}

export function slotsFor(date) {
  const b = blockFor(date);
  if (!b) return [];
  const out = [];
  for (let m = min(b.from); m + SLOT_MIN <= min(b.to); m += SLOT_MIN) out.push(hhmm(m));
  return out;
}

export const startTs = (date, time) => toTs(date, min(time));
export const endTs = (date, time) => toTs(date, min(time) + SLOT_MIN);

// dny, na které se dá online objednat (od dneška po horizont)
export function bookableDates() {
  const t = today();
  const out = [];
  for (let i = 0; i <= HORIZON_DAYS; i++) {
    const d = addDays(t, i);
    if (blockFor(d)) out.push(d);
  }
  return out;
}

export const tooLate = (date, time) => startTs(date, time) - Date.now() < LEAD_MIN * 60000;
