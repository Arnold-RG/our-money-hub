import { assertPassword, cleanEmail, cleanText, cleanUsername, hashPassword, nowIso, randomId, verifyPassword } from "./security.js";

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
    username: row.username || "",
    providers: row.providers || [],
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

export function findAccountByUsername(username) {
  try {
    const clean = cleanUsername(username);
    return load().find((row) => row.username === clean) || null;
  } catch {
    return null;
  }
}

export function findAccountByLogin(login) {
  const value = String(login || "").trim();
  if (!value) return null;
  if (value.includes("@")) return findAccountByEmail(value);
  return findAccountByUsername(value) || findAccountByEmail(value);
}

export async function registerAccount({ name, username, email, password, provider }) {
  const clean = cleanEmail(email);
  if (!clean || !cleanText(name, 80)) throw new Error("Name and email are required.");
  const userName = username
    ? cleanUsername(username)
    : cleanUsername(`${String(email).split("@")[0].replace(/[^a-zA-Z0-9._-]/g, "") || "user"}omh`.slice(0, 32));
  if (findAccountByEmail(clean)) throw new Error("That email already has an Our Money Hub account on this device.");
  if (findAccountByUsername(userName)) throw new Error("That username is already taken on this device.");
  if (!provider) assertPassword(password);
  else if (password) assertPassword(password);
  const hashed = password ? await hashPassword(password) : { hash: "", salt: "" };
  const row = {
    id: randomId(),
    name: cleanText(name, 80),
    username: userName,
    email: clean,
    passwordHash: hashed.hash,
    passwordSalt: hashed.salt,
    biometricOn: false,
    providers: provider ? [provider] : [],
    createdAt: nowIso(),
  };
  const list = load();
  list.push(row);
  save(list);
  return row;
}

export async function verifyAccount(login, password) {
  const row = findAccountByLogin(login);
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
