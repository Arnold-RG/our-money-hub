const text = new TextEncoder();
const decode = new TextDecoder();
const WHO_KEY = "omh.who";

function toB64(bytes) {
  let bin = "";
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin);
}

function fromB64(value) {
  const bin = atob(value);
  return Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
}

export function randomBytes(n = 32) {
  return crypto.getRandomValues(new Uint8Array(n));
}

export function randomId() {
  return `${Date.now().toString(36)}-${crypto.getRandomValues(new Uint8Array(4)).reduce((s, b) => s + b.toString(16).padStart(2, "0"), "")}`;
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

export function writeSession(userId) {
  localStorage.setItem(WHO_KEY, JSON.stringify({ userId }));
}

export function readSession() {
  try {
    const raw = localStorage.getItem(WHO_KEY);
    if (!raw) return null;
    const row = JSON.parse(raw);
    if (!row.userId) return null;
    return { userId: row.userId };
  } catch {
    return null;
  }
}

export function touchSession() {
  return readSession();
}

export function clearSession() {
  localStorage.removeItem(WHO_KEY);
  sessionStorage.removeItem("omh.sid");
}

export function cleanText(value, max = 160) {
  return String(value || "").trim().slice(0, max);
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
