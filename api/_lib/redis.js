// Upstash Redis přes REST, bez závislostí.
// Soubory v api/_lib nejsou samostatné funkce (podtržítko je Vercel přeskočí).

const URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

export const hasRedis = () => Boolean(URL && TOKEN);

// Náhledy a ostrý web sdílí jednu databázi; náhledy proto používají vlastní prostor „pv:“,
// aby testování nikdy nezasáhlo skutečné rezervace, ani zavřené dny.
const NS = process.env.VERCEL_ENV === "production" ? "" : "pv:";
const ns = (k) => NS + k;

function scoped(cmd) {
  if (!NS || cmd.length < 2) return cmd;
  const [name, ...args] = cmd;
  const n = String(name).toUpperCase();
  if (n === "MGET") return [name, ...args.map(ns)];
  if (n === "EVAL") {
    const numkeys = Number(args[1]);
    return [name, args[0], args[1], ...args.slice(2, 2 + numkeys).map(ns), ...args.slice(2 + numkeys)];
  }
  return [name, ns(args[0]), ...args.slice(1)];
}

async function call(path, body) {
  if (!hasRedis()) throw Object.assign(new Error("Databáze není připojená"), { status: 503 });
  const r = await fetch(URL + path, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(`redis: ${j.error || r.status}`);
  return j;
}

export async function redis(...cmd) {
  return (await call("", scoped(cmd).map(String))).result;
}

// více příkazů jedním požadavkem; vrací pole výsledků
export async function pipeline(cmds) {
  if (!cmds.length) return [];
  const res = await call("/pipeline", cmds.map((c) => scoped(c).map(String)));
  return res.map((x) => {
    if (x.error) throw new Error(`redis: ${x.error}`);
    return x.result;
  });
}

export async function getJSON(key) {
  const v = await redis("GET", key);
  return v ? JSON.parse(v) : null;
}

export async function setJSON(key, value, ttlSec) {
  return ttlSec ? redis("SET", key, JSON.stringify(value), "EX", ttlSec) : redis("SET", key, JSON.stringify(value));
}

export async function mgetJSON(keys) {
  if (!keys.length) return [];
  const vals = await redis("MGET", ...keys);
  return vals.map((v) => (v ? JSON.parse(v) : null));
}

export async function lua(script, keys, args) {
  return redis("EVAL", script, keys.length, ...keys, ...args);
}
