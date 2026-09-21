function bufToB64url(buf) {
  const bytes = new Uint8Array(buf);
  let bin = "";
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function b64urlToBuf(value) {
  let b64 = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4) b64 += "=";
  return Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
}

const STORE = "omh.webauthn";

function loadMap() {
  try {
    return JSON.parse(localStorage.getItem(STORE) || "{}");
  } catch {
    return {};
  }
}

export function biometricSupported() {
  return Boolean(window.PublicKeyCredential);
}

export async function platformUnlockReady() {
  if (!biometricSupported()) return false;
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

export function hasBiometricForDevice() {
  return Object.keys(loadMap()).length > 0;
}

export function biometricLinked(userId) {
  return Object.values(loadMap()).includes(userId);
}

export async function registerBiometric(user) {
  if (!biometricSupported()) {
    throw new Error("This device does not offer Face ID, fingerprint, or Windows Hello in the browser.");
  }
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: "Our Money Hub", id: location.hostname },
      user: {
        id: new TextEncoder().encode(user.id),
        name: user.email,
        displayName: user.name,
      },
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },
        { type: "public-key", alg: -257 },
      ],
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        userVerification: "required",
        residentKey: "preferred",
      },
      timeout: 60000,
      attestation: "none",
    },
  });
  if (!cred) throw new Error("Biometric setup was cancelled.");
  const map = loadMap();
  map[bufToB64url(cred.rawId)] = user.id;
  localStorage.setItem(STORE, JSON.stringify(map));
}

export async function unlockWithBiometric() {
  const map = loadMap();
  const ids = Object.keys(map);
  if (!ids.length) throw new Error("No Face ID or fingerprint is saved on this device yet.");
  const cred = await navigator.credentials.get({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rpId: location.hostname,
      allowCredentials: ids.map((id) => ({ type: "public-key", id: b64urlToBuf(id) })),
      userVerification: "required",
      timeout: 60000,
    },
  });
  if (!cred) throw new Error("Biometric sign-in was cancelled.");
  const userId = map[bufToB64url(cred.rawId)];
  if (!userId) throw new Error("That biometric key is not linked to a household account.");
  return userId;
}

export function clearBiometric(userId) {
  const map = loadMap();
  for (const [id, owner] of Object.entries(map)) {
    if (owner === userId) delete map[id];
  }
  localStorage.setItem(STORE, JSON.stringify(map));
}
