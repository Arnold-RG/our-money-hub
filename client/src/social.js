const STORE = "omh.oauth";

export const SOCIAL_PROVIDERS = [
  { id: "google", label: "Google", color: "#ea4335" },
  { id: "apple", label: "Apple", color: "#111111" },
  { id: "facebook", label: "Facebook", color: "#1877f2" },
  { id: "microsoft", label: "Microsoft", color: "#00a4ef" },
  { id: "github", label: "GitHub", color: "#24292f" },
];

export function oauthConfig() {
  try {
    return {
      google: import.meta.env.VITE_GOOGLE_CLIENT_ID || "",
      apple: import.meta.env.VITE_APPLE_CLIENT_ID || "",
      facebook: import.meta.env.VITE_FACEBOOK_APP_ID || "",
      microsoft: import.meta.env.VITE_MICROSOFT_CLIENT_ID || "",
      ...JSON.parse(localStorage.getItem(STORE) || "{}"),
    };
  } catch {
    return {};
  }
}

export function saveOauthConfig(next) {
  localStorage.setItem(STORE, JSON.stringify(next));
}

function decodeJwt(token) {
  const part = String(token || "").split(".")[1];
  if (!part) return {};
  const padded = part.replace(/-/g, "+").replace(/_/g, "/") + "==".slice((part.length % 4) || 4);
  return JSON.parse(atob(padded));
}

export async function signInWithGoogle() {
  const clientId = oauthConfig().google;
  if (!clientId) {
    throw new Error("GOOGLE_SETUP");
  }
  await loadScript("https://accounts.google.com/gsi/client");
  return new Promise((resolve, reject) => {
    try {
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: (response) => {
          const payload = decodeJwt(response.credential);
          resolve({
            provider: "google",
            subject: payload.sub,
            email: String(payload.email || "").toLowerCase(),
            name: payload.name || payload.email,
          });
        },
      });
      window.google.accounts.id.prompt((notice) => {
        if (notice && notice.isNotDisplayed && notice.isNotDisplayed()) {
          reject(new Error("Google sign-in was blocked by the browser. Use email and password, or allow pop-ups."));
        }
      });
    } catch (err) {
      reject(err);
    }
  });
}

export async function signInWithFacebook() {
  const appId = oauthConfig().facebook;
  if (!appId) throw new Error("FACEBOOK_SETUP");
  await loadScript("https://connect.facebook.net/en_US/sdk.js");
  await new Promise((resolve) => {
    window.FB.init({ appId, cookie: true, xfbml: false, version: "v19.0" });
    resolve();
  });
  const session = await new Promise((resolve, reject) => {
    window.FB.login((res) => {
      if (!res.authResponse) reject(new Error("Facebook sign-in was cancelled."));
      else resolve(res.authResponse);
    }, { scope: "email,public_profile" });
  });
  const me = await new Promise((resolve) => {
    window.FB.api("/me", { fields: "name,email" }, resolve);
  });
  return {
    provider: "facebook",
    subject: session.userID,
    email: String(me.email || `${session.userID}@facebook.local`).toLowerCase(),
    name: me.name || "Facebook member",
  };
}

export async function signInWithMicrosoft() {
  const clientId = oauthConfig().microsoft;
  if (!clientId) throw new Error("MICROSOFT_SETUP");
  const redirect = location.href.split("#")[0];
  const url = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=${encodeURIComponent(clientId)}&response_type=id_token&redirect_uri=${encodeURIComponent(redirect)}&scope=openid%20email%20profile&response_mode=fragment&nonce=${Date.now()}`;
  window.location.assign(url);
  throw new Error("Redirecting to Microsoft…");
}

export async function signInWithApple() {
  const clientId = oauthConfig().apple;
  if (!clientId) throw new Error("APPLE_SETUP");
  await loadScript("https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js");
  window.AppleID.auth.init({
    clientId,
    scope: "name email",
    redirectURI: location.href.split("#")[0],
    usePopup: true,
  });
  const res = await window.AppleID.auth.signIn();
  const payload = decodeJwt(res.id_token);
  return {
    provider: "apple",
    subject: payload.sub,
    email: String(payload.email || "").toLowerCase(),
    name: res.user?.name ? `${res.user.name.firstName || ""} ${res.user.name.lastName || ""}`.trim() : payload.email,
  };
}

export async function signInSocial(id) {
  if (id === "google") return signInWithGoogle();
  if (id === "facebook") return signInWithFacebook();
  if (id === "microsoft") return signInWithMicrosoft();
  if (id === "apple") return signInWithApple();
  if (id === "github") throw new Error("GITHUB_SETUP");
  throw new Error("That sign-in method is not available yet.");
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if ([...document.scripts].some((node) => node.src === src)) return resolve();
    const el = document.createElement("script");
    el.src = src;
    el.async = true;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error("Could not load the sign-in service."));
    document.head.appendChild(el);
  });
}
