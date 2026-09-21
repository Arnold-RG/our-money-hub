import { decryptJson, encodeSyncCode, encryptJson, randomBytes, randomId } from "./security.js";

const META_KEY = "omh.meta";
const BLOB_KEY = "omh.blob";
const KEY_KEY = "omh.vk";
const HOUSES_KEY = "omh.houses";
const ACTIVE_KEY = "omh.activeHouse";
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
  const pack = JSON.parse(localStorage.getItem(`${BLOB_KEY}.${id}`) || localStorage.getItem(BLOB_KEY) || "null");
  if (!pack) throw new Error("That household copy is missing on this device.");
  vaultKey = b64ToBytes(house.key);
  memory = await decryptJson(pack, vaultKey);
  localStorage.setItem(BLOB_KEY, JSON.stringify(pack));
  localStorage.setItem(ACTIVE_KEY, id);
  return memory;
}

export function hasLocalVault() {
  return listHouses().length > 0 || Boolean(localStorage.getItem(BLOB_KEY) && localStorage.getItem(KEY_KEY));
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
  const pack = JSON.parse(localStorage.getItem(BLOB_KEY) || "null");
  const keyB64 = localStorage.getItem(KEY_KEY);
  if (!pack || !keyB64) return null;
  vaultKey = b64ToBytes(keyB64);
  memory = await decryptJson(pack, vaultKey);
  return memory;
}

export async function createVault(initial) {
  vaultKey = randomBytes(32);
  memory = initial;
  localStorage.setItem(KEY_KEY, bytesToB64(vaultKey));
  localStorage.removeItem(META_KEY);
  await persist(true);
  return memory;
}

export async function importVault(pack, keyBytes, blobId) {
  memory = await decryptJson(pack, keyBytes);
  vaultKey = keyBytes;
  localStorage.setItem(KEY_KEY, bytesToB64(keyBytes));
  const meta = getMeta();
  if (blobId) meta.blobId = blobId;
  localStorage.setItem(META_KEY, JSON.stringify(meta));
  localStorage.setItem(BLOB_KEY, JSON.stringify(pack));
  if (memory.household?.id) {
    localStorage.setItem(`${BLOB_KEY}.${memory.household.id}`, JSON.stringify(pack));
  }
  snapshotHouse();
  return memory;
}

export async function persist(createRemote = false) {
  if (!memory || !vaultKey) return;
  memory.revision = (memory.revision || 0) + 1;
  memory.updatedAt = new Date().toISOString();
  const pack = await encryptJson(memory, vaultKey);
  localStorage.setItem(BLOB_KEY, JSON.stringify(pack));
  if (memory.household?.id) {
    localStorage.setItem(`${BLOB_KEY}.${memory.household.id}`, JSON.stringify(pack));
  }
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
  if (!meta.blobId || createRemote || meta.host === "bytebin") {
    let created = null;
    const errors = [];
    for (const maker of [createBytebin, createJsonBlob]) {
      try {
        created = await maker(body);
        break;
      } catch (err) {
        errors.push(err.message);
      }
    }
    if (!created) throw new Error("Could not create a household join code. Try again on a network.");
    setMeta({ blobId: created.blobId, host: created.host });
    return;
  }
  const res = await fetch(`${JSONBLOB}/${meta.blobId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body,
  });
  if (!res.ok) {
    const created = await createBytebin(body);
    setMeta({ blobId: created.blobId, host: created.host });
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
    const remote = await decryptJson(pack, vaultKey);
    if ((remote.revision || 0) > (memory?.revision || 0)) {
      memory = remote;
      localStorage.setItem(BLOB_KEY, JSON.stringify({ iv: pack.iv, ct: pack.ct }));
    }
  } catch {
    // Keep the local copy if the network copy cannot be read.
  }
  return memory;
}

export function wipeLocal() {
  memory = null;
  vaultKey = null;
  localStorage.removeItem(BLOB_KEY);
  localStorage.removeItem(KEY_KEY);
  localStorage.removeItem(META_KEY);
}

export function exportEncrypted() {
  const pack = localStorage.getItem(BLOB_KEY);
  const meta = getMeta();
  return {
    app: "omh",
    blobId: meta.blobId || "",
    pack: pack ? JSON.parse(pack) : null,
    exportedAt: new Date().toISOString(),
  };
}
