import { assertPassword, cleanEmail, cleanText, hashPassword, nowIso, randomBytes, randomId, verifyPassword } from "./security.js";
import { bytesToBase32 } from "./totp.js";

const KEY = "omh.accounts";

function load() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "[]");
  } catch {
    return [];
  }
}

function save(list) {
  localStorage.setItem(KEY, JSON.stringify(list));
}

export function publicAccount(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    providers: row.providers || [],
    totpOn: Boolean(row.totpSecret && row.totpConfirmed),
    biometricOn: Boolean(row.biometricOn),
    createdAt: row.createdAt,
  };
}

export function findAccountByEmail(email) {
  return load().find((row) => row.email === cleanEmail(email)) || null;
}

export function findAccountById(id) {
  return load().find((row) => row.id === id) || null;
}

export function findAccountByProvider(provider, subject) {
  return load().find((row) => (row.providers || []).some((item) => item.provider === provider && item.subject === subject)) || null;
}

export async function registerAccount({ name, email, password, provider }) {
  const clean = cleanEmail(email);
  if (!clean || !cleanText(name, 80)) throw new Error("Name and email are required.");
  if (findAccountByEmail(clean)) throw new Error("That email already has an Our Money Hub account on this device.");
  if (!provider) assertPassword(password);
  else if (password) assertPassword(password);
  const hashed = password ? await hashPassword(password) : { hash: "", salt: "" };
  const row = {
    id: randomId(),
    name: cleanText(name, 80),
    email: clean,
    passwordHash: hashed.hash,
    passwordSalt: hashed.salt,
    totpSecret: bytesToBase32(randomBytes(20)),
    totpConfirmed: false,
    biometricOn: false,
    providers: provider ? [provider] : [],
    createdAt: nowIso(),
  };
  const list = load();
  list.push(row);
  save(list);
  return row;
}

export async function verifyAccount(email, password) {
  const row = findAccountByEmail(email);
  if (!row) return null;
  if (!row.passwordHash) return null;
  const ok = await verifyPassword(password, row.passwordHash, row.passwordSalt);
  return ok ? row : null;
}

export function patchAccount(id, patch) {
  const list = load();
  const idx = list.findIndex((row) => row.id === id);
  if (idx < 0) throw new Error("Account not found.");
  list[idx] = { ...list[idx], ...patch };
  save(list);
  return list[idx];
}

export function linkProvider(id, provider) {
  const row = findAccountById(id);
  if (!row) throw new Error("Account not found.");
  const providers = [...(row.providers || [])];
  if (!providers.some((item) => item.provider === provider.provider && item.subject === provider.subject)) {
    providers.push(provider);
  }
  return patchAccount(id, { providers });
}
