import crypto from "node:crypto";
import { redis } from "./redis.js";

export const isProd = () => process.env.VERCEL_ENV === "production";

// adresa webu pro odkazy v e-mailech
export function baseUrl(req) {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/$/, "");
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `https://${host}`;
}

export function body(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return {};
}

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export const fail = (status, message) => { throw new HttpError(status, message); };

// obalí handler: jednotné chyby a JSON odpovědi
export function route(handlers) {
  return async (req, res) => {
    const a = (req.query && req.query.a) || "";
    const own = (k) => (Object.prototype.hasOwnProperty.call(handlers, k) ? handlers[k] : null);
    const h = own(`${req.method} ${a}`);
    res.setHeader("Cache-Control", "no-store");
    try {
      if (!h) fail(404, "Neznámá akce");
      const out = await h(req, res);
      if (!res.headersSent && out !== undefined) res.status(200).json(out);
    } catch (err) {
      const status = err.status || 500;
      if (status >= 500) console.error(err);
      if (!res.headersSent) {
        res.status(status).json({
          error: status >= 500 && status !== 503 ? "Něco se pokazilo. Zkuste to prosím znovu nebo zavolejte na 554 611 766." : err.message,
        });
      }
    }
  };
}

export const id = (n = 16) => crypto.randomBytes(n).toString("base64url");

// tajný klíč pro podpisy; když není v env, vygeneruje se jednou a uloží do databáze
let secretCache;
export async function secret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  if (secretCache) return secretCache;
  await redis("SET", "sys:secret", id(32), "NX");
  return (secretCache = await redis("GET", "sys:secret"));
}

export async function sign(value) {
  return crypto.createHmac("sha256", await secret()).update(value).digest("base64url");
}

export function same(a, b) {
  const x = Buffer.from(String(a || "")), y = Buffer.from(String(b || ""));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export async function verify(value, sig) {
  return Boolean(sig) && same(await sign(value), sig);
}

export function cookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function setCookie(res, name, value, maxAgeSec) {
  res.setHeader("Set-Cookie", `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAgeSec}`);
}

export const ip = (req) => String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "?";

// jednoduché omezení počtu požadavků (ochrana proti spamu a hádání hesla)
export async function limit(key, max, windowSec) {
  const n = await redis("INCR", `rl:${key}`);
  if (n === 1) await redis("EXPIRE", `rl:${key}`, windowSec);
  if (n > max) fail(429, "Příliš mnoho pokusů. Zkuste to prosím později.");
}

export const clean = (v, max = 200) => String(v ?? "").trim().replace(/\s+/g, " ").slice(0, max);
export const cleanText = (v, max = 1000) => String(v ?? "").trim().slice(0, max);

export function email(v, required = true) {
  const e = clean(v, 254).toLowerCase();
  if (!e && !required) return "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)) fail(400, "Zkontrolujte prosím e-mail.");
  return e;
}

export function phone(v) {
  let p = String(v || "").replace(/[\s\-().\/]/g, "");
  if (p.startsWith("00")) p = "+" + p.slice(2);
  if (/^\d{9}$/.test(p)) p = "+420" + p;
  if (!/^\+\d{11,14}$/.test(p)) fail(400, "Zkontrolujte prosím telefon (např. 777 123 456).");
  return p;
}

export const prettyPhone = (p) => p.replace(/^\+420(\d{3})(\d{3})(\d{3})$/, "$1 $2 $3");
