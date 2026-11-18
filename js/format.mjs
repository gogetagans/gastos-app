export const IDLE_MS = 15 * 60 * 1000;

export function uid() {
  return globalThis.crypto.randomUUID();
}

export function todayISO(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function nowISO() {
  return new Date().toISOString();
}

export function cents(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100);
}

export function formatEuro(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  const sign = n < 0 ? "−" : "";
  const [ints, decs] = Math.abs(n).toFixed(2).split(".");
  const grouped = ints.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${sign}${grouped},${decs} €`;
}

export function formatDate(value) {
  if (!value) return "—";
  const iso = String(value).slice(0, 10);
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return String(value);
  return `${match[3]}/${match[2]}/${match[1]}`;
}

export function parseAmount(input) {
  if (typeof input === "number") return Number.isFinite(input) ? input : null;
  let s = String(input ?? "")
    .trim()
    .replace(/[\s\u00a0]/g, "")
    .replace(/€/g, "");
  if (!s) return null;
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma !== -1 && lastDot !== -1) {
    if (lastComma > lastDot) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
  } else if (lastComma !== -1) {
    s = s.replace(",", ".");
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function fold(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s*\/\s*/g, "/")
    .replace(/\s+/g, " ")
    .trim();
}

export function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[ch]));
}

export function coerceDate(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number" && value > 20000 && value < 80000) {
    const utc = Date.UTC(1899, 11, 30) + Math.round(value) * 86400000;
    return new Date(utc).toISOString().slice(0, 10);
  }
  const s = String(value).trim();
  let match = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  match = s.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/);
  if (match) {
    return `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
  }
  return null;
}

export function isOlderThanMonths(isoDate, months, today) {
  const point = coerceDate(isoDate);
  const base = coerceDate(today);
  if (!point || !base) return false;
  const [y, m, d] = point.split("-").map(Number);
  const [ty, tm, td] = base.split("-").map(Number);
  const limit = new Date(ty, tm - 1, td);
  limit.setMonth(limit.getMonth() - months);
  return new Date(y, m - 1, d) < limit;
}

export function prefersReducedMotion() {
  return globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
}
