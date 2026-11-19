/**
 * IndexedDB helpers for sealed household blobs.
 * Prefer IDB over localStorage for encrypted vault payloads.
 */

const DB_NAME = "omh-vault";
const DB_VERSION = 1;
const STORE = "blobs";

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("omh_idb_open_failed"));
  });
}

function idbReq(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("omh_idb_req_failed"));
  });
}

export async function idbPut(key, value) {
  const db = await openDb();
  await idbReq(db.transaction(STORE, "readwrite").objectStore(STORE).put(value, key));
}

export async function idbGet(key) {
  const db = await openDb();
  return idbReq(db.transaction(STORE, "readonly").objectStore(STORE).get(key));
}

export async function idbDelete(key) {
  const db = await openDb();
  await idbReq(db.transaction(STORE, "readwrite").objectStore(STORE).delete(key));
}

export async function idbClear() {
  const db = await openDb();
  await idbReq(db.transaction(STORE, "readwrite").objectStore(STORE).clear());
}
