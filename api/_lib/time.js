// Práce s pražským časem bez knihoven (letní/zimní čas řeší Intl).
const TZ = "Europe/Prague";

const fmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, weekday: "short",
});

const WD = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

// rozloží UTC čas na pražské složky
export function parts(ts) {
  const p = {};
  for (const x of fmt.formatToParts(new Date(ts))) p[x.type] = x.value;
  const hour = p.hour === "24" ? 0 : Number(p.hour);
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    weekday: WD[p.weekday],
    minutes: hour * 60 + Number(p.minute),
    y: Number(p.year), m: Number(p.month), d: Number(p.day),
  };
}

// pražské datum + minuty od půlnoci → UTC timestamp
export function toTs(date, minutes) {
  const [y, m, d] = date.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d, 0, minutes);
  const p = parts(guess);
  const local = Date.UTC(p.y, p.m - 1, p.d, 0, p.minutes);
  return guess - (local - guess);
}

export const today = () => parts(Date.now()).date;

export function addDays(date, n) {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

export function weekday(date) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export const hhmm = (min) => `${String(Math.floor(min / 60) % 24).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

export function human(ts) {
  return new Date(ts).toLocaleString("cs-CZ", {
    timeZone: TZ, weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit",
  });
}

export const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
