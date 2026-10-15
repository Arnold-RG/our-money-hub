import { decryptJson, encodeSyncCode, encryptJson, randomBytes, randomId } from "./security.js";
import { idbClear, idbGet, idbPut } from "./idb.js";

const META_KEY = "omh.meta";
const BLOB_KEY = "omh.blob";
const KEY_KEY = "omh.vk";
const HOUSES_KEY = "omh.houses";
const ACTIVE_KEY = "omh.activeHouse";
const IDB_ACTIVE = "active";
const JSONBLOB = "https://jsonblob.com/api/jsonBlob";
const BYTEBIN = "https://bytebin.lucko.me";

let memory = null;
let vaultKey = null;

function bytesToB64(bytes) {
  let bin = "";
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin);
}

function b64ToBytes(value) {
  return Uint8Array.from(atob(value), (ch) => ch.charCodeAt(0));
}

function hydrateVault(vault) {
  if (!vault) return vault;
  if (!Array.isArray(vault.messages)) vault.messages = [];
  if (Array.isArray(vault.users)) {
    vault.users = vault.users.map((row) => ({
      id: row.id,
      name: row.name,
      role: row.role,
      createdAt: row.createdAt,
    }));
  }
  return vault;
}

async function readPack(houseId) {
  if (houseId) {
    const scoped = await idbGet(`${BLOB_KEY}.${houseId}`);
    if (scoped?.iv && scoped?.ct) return scoped;
  }
  const active = await idbGet(IDB_ACTIVE);
  if (active?.iv && active?.ct) return active;
  // Migrate legacy localStorage ciphertext once.
  const legacyRaw = localStorage.getItem(houseId ? `${BLOB_KEY}.${houseId}` : BLOB_KEY)
    || localStorage.getItem(BLOB_KEY);
  if (!legacyRaw) return null;
  try {
    const pack = JSON.parse(legacyRaw);
    if (pack?.iv && pack?.ct) {
      await writePack(pack, houseId);
      localStorage.removeItem(BLOB_KEY);
      if (houseId) localStorage.removeItem(`${BLOB_KEY}.${houseId}`);
      return pack;
    }
  } catch {
    return null;
  }
  return null;
}

async function writePack(pack, houseId) {
  await idbPut(IDB_ACTIVE, pack);
  if (houseId) await idbPut(`${BLOB_KEY}.${houseId}`, pack);
}

export function wipeOldLoginStore() {
  [
    "omh.accounts",
    "omh.lock",
    "omh.oauth",
    "omh.google",
    "omh.webauthn",
    "omh.bio",
  ].forEach((key) => localStorage.removeItem(key));
  sessionStorage.removeItem("omh.sid");
  const drop = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (!key) continue;
    if (key.startsWith("omh.") && /oauth|totp|webauthn|biometric|password|account/i.test(key)) {
      drop.push(key);
    }
  }
  drop.forEach((key) => localStorage.removeItem(key));
}

export function emptyVault() {
  return {
    version: 1,
    revision: 1,
    household: { id: randomId(), name: "Our household", currency: "PLN", createdAt: new Date().toISOString() },
    users: [],
    grants: {},
    incomes: [],
    expenses: [],
    costs: [],
    savings: [],
    savingsEntries: [],
    projects: [],
    projectEntries: [],
    messages: [],
    activity: [],
    lists: [
      { id: "list-backlog", title: "How we start", order: 0 },
      { id: "list-ready", title: "Ready", order: 1 },
      { id: "list-motion", title: "In motion", order: 2 },
      { id: "list-wait", title: "Waiting", order: 3 },
      { id: "list-done", title: "Finished", order: 4 },
    ],
    cards: [],
  };
}

export function listHouses() {
  migrateLegacy();
  try {
    return JSON.parse(localStorage.getItem(HOUSES_KEY) || "[]");
  } catch {
    return [];
  }
}

function migrateLegacy() {
  if (localStorage.getItem(HOUSES_KEY)) return;
  if (!localStorage.getItem(BLOB_KEY) || !localStorage.getItem(KEY_KEY)) return;
  const meta = getMeta();
  localStorage.setItem(HOUSES_KEY, JSON.stringify([{
    id: "legacy",
    name: "Household",
    blobId: meta.blobId || "",
    key: localStorage.getItem(KEY_KEY),
  }]));
  localStorage.setItem(ACTIVE_KEY, "legacy");
}

function snapshotHouse() {
  if (!memory?.household) return;
  const row = {
    id: memory.household.id,
    name: memory.household.name,
    blobId: getMeta().blobId || "",
    key: localStorage.getItem(KEY_KEY),
  };
  const houses = listHouses().filter((item) => item.id !== row.id);
  houses.unshift(row);
  localStorage.setItem(HOUSES_KEY, JSON.stringify(houses));
  localStorage.setItem(ACTIVE_KEY, row.id);
}

export async function activateHouse(id) {
  const house = listHouses().find((item) => item.id === id);
  if (!house) throw new Error("That household is not saved on this device.");
  localStorage.setItem(KEY_KEY, house.key);
  localStorage.setItem(META_KEY, JSON.stringify({ blobId: house.blobId }));
  const pack = await readPack(id);
  if (!pack) throw new Error("That household copy is missing on this device.");
  vaultKey = b64ToBytes(house.key);
  memory = hydrateVault(await decryptJson(pack, vaultKey));
  await writePack(pack, id);
  localStorage.setItem(ACTIVE_KEY, id);
  return memory;
}

export function hasLocalVault() {
  return listHouses().length > 0 || Boolean(localStorage.getItem(KEY_KEY));
}

export function getMeta() {
  try {
    return JSON.parse(localStorage.getItem(META_KEY) || "{}");
  } catch {
    return {};
  }
}

export function getSyncCode() {
  if (!vaultKey) return "";
  const blobId = getMeta().blobId;
  if (!blobId) return "";
  return encodeSyncCode(blobId, vaultKey);
}

export function isOpen() {
  return Boolean(memory);
}

export function currentVault() {
  if (!memory) throw new Error("The household vault is locked.");
  return memory;
}

export function setVault(next) {
  memory = next;
}

export async function openLocalVault() {
  const keyB64 = localStorage.getItem(KEY_KEY);
  if (!keyB64) return null;
  const pack = await readPack(localStorage.getItem(ACTIVE_KEY) || undefined);
  if (!pack) return null;
  vaultKey = b64ToBytes(keyB64);
  memory = hydrateVault(await decryptJson(pack, vaultKey));
  return memory;
}

export async function createVault(initial) {
  vaultKey = randomBytes(32);
  memory = hydrateVault(initial);
  localStorage.setItem(KEY_KEY, bytesToB64(vaultKey));
  localStorage.removeItem(META_KEY);
  await persist(true);
  return memory;
}

export async function importVault(pack, keyBytes, blobId) {
  memory = hydrateVault(await decryptJson(pack, keyBytes));
  vaultKey = keyBytes;
  localStorage.setItem(KEY_KEY, bytesToB64(keyBytes));
  const meta = getMeta();
  if (blobId) meta.blobId = blobId;
  localStorage.setItem(META_KEY, JSON.stringify(meta));
  await writePack(pack, memory.household?.id);
  snapshotHouse();
  return memory;
}

export async function persist(createRemote = false) {
  if (!memory || !vaultKey) return;
  memory.revision = (memory.revision || 0) + 1;
  memory.updatedAt = new Date().toISOString();
  const pack = await encryptJson(memory, vaultKey);
  await writePack(pack, memory.household?.id);
  try {
    await pushRemote(pack, createRemote);
  } catch (err) {
    if (createRemote) throw err;
  }
  snapshotHouse();
  if (createRemote && !getSyncCode()) {
    throw new Error("The household was saved on this device, but a join code could not be created. Try again.");
  }
}

function setMeta(patch) {
  localStorage.setItem(META_KEY, JSON.stringify({ ...getMeta(), ...patch }));
}

function remoteGetUrl(blobId, host) {
  if (host === "bytebin" || (blobId && !String(blobId).includes("-"))) {
    return `${BYTEBIN}/${blobId}`;
  }
  return `${JSONBLOB}/${blobId}`;
}

async function createJsonBlob(body) {
  const res = await fetch(JSONBLOB, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body,
  });
  if (!res.ok) throw new Error("jsonblob");
  const location = res.headers.get("Location") || "";
  const blobId = location.split("/").pop();
  if (!blobId) throw new Error("jsonblob");
  return { host: "jsonblob", blobId };
}

async function createBytebin(body) {
  const res = await fetch(`${BYTEBIN}/post`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body,
  });
  if (!res.ok) throw new Error("bytebin");
  let blobId = res.headers.get("Location") || "";
  try {
    const data = await res.json();
    blobId = data.key || blobId;
  } catch {
    /* header only */
  }
  blobId = String(blobId).split("/").pop();
  if (!blobId) throw new Error("bytebin");
  return { host: "bytebin", blobId };
}

async function pushRemote(pack, createRemote) {
  const meta = getMeta();
  const body = JSON.stringify({ v: 1, ...pack, revision: memory.revision });
  if (!meta.blobId || createRemote) {
    let created = null;
    for (const maker of [createJsonBlob, createBytebin]) {
      try {
        created = await maker(body);
        break;
      } catch {
        /* try the other host */
      }
    }
    if (!created) throw new Error("Could not create a household join code. Try again on a network.");
    setMeta({ blobId: created.blobId, host: created.host });
    return;
  }
  if (meta.host !== "bytebin" && String(meta.blobId).includes("-")) {
    const res = await fetch(`${JSONBLOB}/${meta.blobId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body,
    });
    if (res.ok) return;
  }
}

async function fetchPack(blobId) {
  const hosts = blobId.includes("-") ? ["jsonblob", "bytebin"] : ["bytebin", "jsonblob"];
  for (const host of hosts) {
    try {
      const res = await fetch(remoteGetUrl(blobId, host), { headers: { Accept: "application/json" } });
      if (!res.ok) continue;
      const pack = await res.json();
      if (pack?.iv && pack?.ct) return pack;
    } catch {
      /* try the other host */
    }
  }
  return null;
}

export async function pullRemote(blobId, keyBytes) {
  const pack = await fetchPack(blobId);
  if (!pack) throw new Error("Could not find that household. Check the join code or link.");
  return importVault(pack, keyBytes, blobId);
}

export async function refreshFromRemote() {
  const meta = getMeta();
  if (!meta.blobId || !vaultKey) return memory;
  try {
    const pack = await fetchPack(meta.blobId);
    if (!pack) return memory;
    const remote = hydrateVault(await decryptJson(pack, vaultKey));
    if ((remote.revision || 0) > (memory?.revision || 0)) {
      memory = remote;
      await writePack({ iv: pack.iv, ct: pack.ct }, memory.household?.id);
    }
  } catch {
    // Keep the local copy if the network copy cannot be read.
  }
  return memory;
}

export async function wipeLocal() {
  memory = null;
  vaultKey = null;
  localStorage.removeItem(BLOB_KEY);
  localStorage.removeItem(KEY_KEY);
  localStorage.removeItem(META_KEY);
  try {
    await idbClear();
  } catch {
    /* ignore */
  }
}

export async function exportEncrypted() {
  const pack = await readPack(localStorage.getItem(ACTIVE_KEY) || undefined);
  const meta = getMeta();
  return {
    app: "omh",
    blobId: meta.blobId || "",
    pack,
    exportedAt: new Date().toISOString(),
  };
}
