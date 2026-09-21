const text = new TextEncoder();
const decode = new TextDecoder();
const LOCK_AFTER = 5;
const LOCK_MS = 15 * 60 * 1000;
const IDLE_MS = 20 * 60 * 1000;
const SESSION_MS = 8 * 60 * 60 * 1000;

function toB64(bytes) {
  let bin = "";
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin);
}

function fromB64(value) {
  const bin = atob(value);
  return Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
}

function toHex(bytes) {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function randomBytes(n = 32) {
  return crypto.getRandomValues(new Uint8Array(n));
}

export function randomId() {
  return `${Date.now().toString(36)}-${crypto.getRandomValues(new Uint8Array(4)).reduce((s, b) => s + b.toString(16).padStart(2, "0"), "")}`;
}

export function assertPassword(password) {
  const value = String(password || "");
  if (value.length < 10) throw new Error("Password must be at least 10 characters.");
  if (!/[A-Za-z]/.test(value) || !/[0-9]/.test(value)) {
    throw new Error("Use both letters and numbers in the password.");
  }
}

export async function hashPassword(password, saltB64) {
  const salt = saltB64 ? fromB64(saltB64) : randomBytes(16);
  const base = await crypto.subtle.importKey("raw", text.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: 210000 },
    base,
    256
  );
  return { hash: toHex(new Uint8Array(bits)), salt: toB64(salt) };
}

export async function verifyPassword(password, hash, salt) {
  const next = await hashPassword(password, salt);
  if (next.hash.length !== hash.length) return false;
  let diff = 0;
  for (let i = 0; i < next.hash.length; i += 1) diff |= next.hash.charCodeAt(i) ^ hash.charCodeAt(i);
  return diff === 0;
}

export async function encryptJson(payload, keyBytes) {
  const iv = randomBytes(12);
  const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["encrypt"]);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, text.encode(JSON.stringify(payload)));
  return { iv: toB64(iv), ct: toB64(new Uint8Array(ct)) };
}

export async function decryptJson(pack, keyBytes) {
  const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["decrypt"]);
  const raw = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(pack.iv) }, key, fromB64(pack.ct));
  return JSON.parse(decode.decode(raw));
}

export function encodeSyncCode(blobId, keyBytes) {
  return `OMH-1.${blobId}.${toB64(keyBytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")}`;
}

export function decodeSyncCode(code) {
  const clean = String(code || "").trim();
  const parts = clean.split(".");
  if (parts.length !== 3 || parts[0] !== "OMH-1" || !parts[1] || !parts[2]) {
    throw new Error("That household join code is not valid.");
  }
  let b64 = parts[2].replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4) b64 += "=";
  return { blobId: parts[1], keyBytes: fromB64(b64) };
}

export function readLock(email) {
  try {
    const all = JSON.parse(localStorage.getItem("omh.lock") || "{}");
    return all[String(email || "").toLowerCase()] || { fails: 0, until: 0 };
  } catch {
    return { fails: 0, until: 0 };
  }
}

export function guardLogin(email) {
  const row = readLock(email);
  if (row.until && Date.now() < row.until) {
    const mins = Math.ceil((row.until - Date.now()) / 60000);
    throw new Error(`Too many failed sign-ins. Try again in ${mins} minute${mins === 1 ? "" : "s"}.`);
  }
}

export function noteLogin(email, ok) {
  const key = String(email || "").toLowerCase();
  const all = JSON.parse(localStorage.getItem("omh.lock") || "{}");
  if (ok) {
    delete all[key];
  } else {
    const fails = (all[key]?.fails || 0) + 1;
    all[key] = { fails, until: fails >= LOCK_AFTER ? Date.now() + LOCK_MS : 0 };
  }
  localStorage.setItem("omh.lock", JSON.stringify(all));
}

export function writeSession(userId) {
  const now = Date.now();
  sessionStorage.setItem("omh.sid", JSON.stringify({
    userId,
    exp: now + SESSION_MS,
    idle: now + IDLE_MS,
  }));
}

export function readSession() {
  try {
    const raw = sessionStorage.getItem("omh.sid");
    if (!raw) return null;
    const row = JSON.parse(raw);
    const now = Date.now();
    if (!row.userId || now > row.exp || now > row.idle) {
      sessionStorage.removeItem("omh.sid");
      return null;
    }
    return row;
  } catch {
    return null;
  }
}

export function touchSession() {
  const row = readSession();
  if (!row) return null;
  row.idle = Date.now() + IDLE_MS;
  sessionStorage.setItem("omh.sid", JSON.stringify(row));
  return row;
}

export function clearSession() {
  sessionStorage.removeItem("omh.sid");
}

export function cleanText(value, max = 160) {
  return String(value || "").trim().slice(0, max);
}

export function cleanEmail(value) {
  return String(value || "").trim().toLowerCase().slice(0, 160);
}

export function parseCents(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

export function parseDate(value) {
  const textValue = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(textValue) ? textValue : null;
}

export function nowIso() {
  return new Date().toISOString();
}

export function monthBounds(month) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(month || ""));
  const now = new Date();
  const year = match ? Number(match[1]) : now.getFullYear();
  const mo = match ? Number(match[2]) : now.getMonth() + 1;
  const start = `${year}-${String(mo).padStart(2, "0")}-01`;
  const endDate = new Date(year, mo, 0).getDate();
  const end = `${year}-${String(mo).padStart(2, "0")}-${String(endDate).padStart(2, "0")}`;
  return { month: `${year}-${String(mo).padStart(2, "0")}`, start, end };
}
