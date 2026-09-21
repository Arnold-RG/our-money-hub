import { useEffect, useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { api } from "../api.js";
import { CURRENCY_CODES } from "../catalogs.js";
import { otpauthUrl } from "../totp.js";
import { codeFromInviteText, copyText, joinUrl, qrDataUrl, scanQrFromFile, shareInvite } from "../share.js";
import { oauthConfig, saveOauthConfig, signInSocial } from "../social.js";
import { hasBiometricForDevice, platformUnlockReady, registerBiometric, unlockWithBiometric } from "../biometrics.js";
import { Field, Notice, OmhMark } from "../ui.jsx";

export function Welcome({ boot, onDone }) {
  const location = useLocation();
  const [params] = useSearchParams();
  const pathCode = decodeURIComponent((location.pathname.match(/^\/join\/(.+)$/) || [])[1] || "");
  const urlCode = params.get("code") || pathCode || "";
  const start = location.pathname.startsWith("/join") || urlCode ? "join" : location.pathname.startsWith("/create") ? "create" : location.pathname.startsWith("/signin") ? "signin" : "home";
  const [view, setView] = useState(start);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [busy, setBusy] = useState(false);
  const [googleId, setGoogleId] = useState(() => oauthConfig().google || "");
  const [form, setForm] = useState({
    name: "",
    username: "",
    email: "",
    password: "",
    householdName: "Our household",
    currency: "PLN",
    syncCode: urlCode,
    totpCode: "",
    provider: null,
  });
  const [invite, setInvite] = useState({ code: "", url: "", qr: "" });
  const [totpSecret, setTotpSecret] = useState("");
  const [totpQr, setTotpQr] = useState("");
  const [bioReady, setBioReady] = useState(false);
  const [who, setWho] = useState(null);

  useEffect(() => {
    platformUnlockReady().then(setBioReady);
  }, []);

  useEffect(() => {
    if (urlCode) setForm((prev) => ({ ...prev, syncCode: urlCode }));
  }, [urlCode]);

  useEffect(() => {
    if (boot?.user) {
      setWho(boot.user);
      setForm((prev) => ({
        ...prev,
        email: prev.email || boot.user.email || "",
        name: prev.name || boot.user.name || "",
        username: prev.username || boot.user.username || "",
      }));
    }
  }, [boot?.user]);

  useEffect(() => {
    if (boot?.needsTotp && boot.totpSecret) {
      setTotpSecret(boot.totpSecret);
      setView("totp");
    } else if (boot?.needsTotp) {
      setView("totp-login");
    } else if (boot?.needsBio) {
      setView("bio");
    }
  }, [boot?.needsTotp, boot?.needsBio, boot?.totpSecret]);

  useEffect(() => {
    if (!totpSecret || !form.email) return;
    qrDataUrl(otpauthUrl(form.email, totpSecret)).then(setTotpQr).catch(() => {});
  }, [totpSecret, form.email]);

  function set(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function afterAuth(result) {
    if (result.user) setWho(result.user);
    if (result.syncCode) {
      const url = result.joinUrl || joinUrl(result.syncCode);
      setInvite({ code: result.syncCode, url, qr: await qrDataUrl(url) });
    }
    const secret = result.totpSecret || totpSecret;
    const role = result.user?.role || boot?.user?.role;
    if (role === "admin" && result.needsTotp && !secret) {
      setView("totp-login");
      return;
    }
    if (role === "admin" && secret) {
      setTotpSecret(secret);
      setView("totp");
      return;
    }
    if (bioReady && !(boot?.user?.account?.biometricOn)) {
      setView("bio");
      return;
    }
    if (result.syncCode) {
      setView("invite");
      return;
    }
    onDone();
  }

  async function create(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await afterAuth(await api.setup(form));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function join(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await afterAuth(await api.join(form));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function signin(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await api.login(form);
      if (result.needsTotp && !result.totpSecret) {
        setView("totp-login");
        return;
      }
      await afterAuth(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function google() {
    setBusy(true);
    setError("");
    try {
      if (googleId && !oauthConfig().google) {
        saveOauthConfig({ ...oauthConfig(), google: googleId });
      }
      const identity = await signInSocial("google");
      setForm((prev) => ({
        ...prev,
        name: identity.name || prev.name,
        email: identity.email,
        username: prev.username || identity.email.split("@")[0],
        provider: identity,
      }));
      if (view === "signin") {
        const result = await api.loginSocial(identity);
        if (!result.linked) {
          setView("create");
          setOk("Google connected. Create your household to finish.");
          return;
        }
        await afterAuth(result);
        return;
      }
      if (view === "create") {
        setOk("Google connected. Add a username and password, then create the household.");
      }
    } catch (err) {
      if (String(err.message).includes("GOOGLE_SETUP")) {
        setView("google");
      } else {
        setError(err.message);
      }
    } finally {
      setBusy(false);
    }
  }

  async function confirmTotp(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (view === "totp-login") await api.verifyLoginTotp(form.totpCode);
      else await api.confirmTotp(form.totpCode);
      if (bioReady && !(boot?.user?.account?.biometricOn)) setView("bio");
      else if (invite.code || boot?.syncCode) {
        const code = invite.code || boot.syncCode;
        const url = invite.url || joinUrl(code);
        setInvite({ code, url, qr: await qrDataUrl(url) });
        setView("invite");
      } else onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function enrollBio() {
    setBusy(true);
    setError("");
    try {
      const session = who || boot?.user || { id: "pending", email: form.email, name: form.name || form.username };
      await registerBiometric(session);
      await api.markBiometric();
      if (invite.code || boot?.syncCode) {
        const code = invite.code || boot.syncCode;
        const url = invite.url || joinUrl(code);
        setInvite({ code, url, qr: await qrDataUrl(url) });
        setView("invite");
      } else onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (view === "home") {
    return (
      <div className="auth-wrap">
        <div className="auth-card">
          <Brand />
          <h2>Sign in to your household.</h2>
          <p className="lede">Create a house as admin, or join with the link or code an admin sends you. Members make their own username, email, and password.</p>
          <div className="home-actions">
            <button className="btn" onClick={() => setView("create")}>Create a household</button>
            <button className="btn-ghost" onClick={() => setView("join")}>Join with a code or link</button>
            <button className="btn-ghost" onClick={() => setView("signin")}>Sign in</button>
          </div>
        </div>
      </div>
    );
  }

  if (view === "google") {
    return (
      <div className="auth-wrap">
        <form className="auth-card" onSubmit={(event) => {
          event.preventDefault();
          saveOauthConfig({ ...oauthConfig(), google: googleId.trim() });
          setView("signin");
          setOk("Google client ID saved. Tap Continue with Google again.");
        }}>
          <Brand />
          <h2>Turn on Google sign-in</h2>
          <p className="lede">Add a Google Cloud web client ID once. Authorized origin: {location.origin}. Redirect: {`${location.origin}${(import.meta.env.BASE_URL || "/").replace(/\/$/, "")}/oauth-google.html`}.</p>
          <Notice error={error} ok={ok} />
          <Field label="Google client ID" wide>
            <input value={googleId} onChange={(e) => setGoogleId(e.target.value)} required placeholder="….apps.googleusercontent.com" />
          </Field>
          <div className="row" style={{ marginTop: 16 }}>
            <button className="btn-ghost" type="button" onClick={() => setView("signin")}>Back</button>
            <button className="btn" type="submit">Save and continue</button>
          </div>
        </form>
      </div>
    );
  }

  if (view === "invite") {
    return (
      <div className="auth-wrap">
        <div className="auth-card">
          <Brand />
          <h2>Share this house</h2>
          <p className="lede">Only you, the admin, can send this. Members open the link or paste the code, then create their own username, email, and password.</p>
          {invite.qr && <img className="invite-qr" src={invite.qr} alt="Household join QR code" />}
          <p className="hint">{invite.url}</p>
          <textarea readOnly value={invite.code} rows={3} />
          <Notice error={error} ok={ok} />
          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn" type="button" onClick={async () => {
              try {
                const how = await shareInvite({ ...invite, name: form.householdName });
                setOk(how === "shared" ? "Invite sent." : "Link and code copied.");
              } catch (err) {
                setError(err.message);
              }
            }}>Send invite</button>
            <button className="btn-ghost" type="button" onClick={async () => { await copyText(invite.url); setOk("Join link copied."); }}>Copy link</button>
            <button className="btn-ghost" type="button" onClick={async () => { await copyText(invite.code); setOk("Join code copied."); }}>Copy code</button>
          </div>
          <button className="btn" style={{ marginTop: 14, width: "100%" }} type="button" onClick={onDone}>Enter the household</button>
        </div>
      </div>
    );
  }

  if (view === "totp" || view === "totp-login") {
    return (
      <div className="auth-wrap">
        <form className="auth-card" onSubmit={confirmTotp}>
          <Brand />
          <h2>Admin authenticator</h2>
          <p className="lede">Only the household admin uses an authenticator app. Scan the QR, then enter the 6-digit code.</p>
          {totpQr && view === "totp" ? <img className="invite-qr" src={totpQr} alt="Authenticator QR" /> : null}
          {totpSecret && view === "totp" ? <p className="hint">Secret: {totpSecret}</p> : null}
          <Notice error={error} />
          <Field label="6-digit code" wide>
            <input name="one-time-code" autoComplete="one-time-code" inputMode="numeric" value={form.totpCode} onChange={(e) => set("totpCode", e.target.value)} required />
          </Field>
          <button className="btn" style={{ marginTop: 14 }} disabled={busy}>{busy ? "Checking…" : "Confirm code"}</button>
        </form>
      </div>
    );
  }

  if (view === "bio") {
    return (
      <div className="auth-wrap">
        <div className="auth-card">
          <Brand />
          <h2>Face or fingerprint</h2>
          <p className="lede">Admins and members both save Face ID, Touch ID, Windows Hello, or a fingerprint on this device.</p>
          <Notice error={error} />
          <button className="btn bio-btn" disabled={busy} onClick={enrollBio}>{busy ? "Waiting for the sensor…" : "Add Face or fingerprint now"}</button>
          {!bioReady && <p className="hint">This browser has no platform authenticator. Use a phone with Face ID or a computer with Windows Hello, then try again.</p>}
        </div>
      </div>
    );
  }

  const creating = view === "create";
  const joining = view === "join";
  return (
    <div className="auth-wrap">
      <form className="auth-card" method="post" autoComplete="on" action="#" onSubmit={creating ? create : joining ? join : signin}>
        <Brand />
        <h2>{creating ? "Create your household" : joining ? "Join a household" : "Sign in"}</h2>
        <p className="lede">
          {creating
            ? "You become the admin. After this, the app generates a join code and link that only you can share."
            : joining
              ? "Paste the admin’s code or open their invite link. Then create your own username, email, and password."
              : "Use your username or email and password. Google is available here. Face or fingerprint unlocks this device."}
        </p>
        {(creating || !joining) && (
          <button className="google-btn" type="button" disabled={busy} onClick={google}>
            <GoogleMark />
            Continue with Google
          </button>
        )}
        {view === "signin" && hasBiometricForDevice() && (
          <button className="btn bio-btn" type="button" disabled={busy} onClick={async () => {
            setBusy(true); setError("");
            try {
              await afterAuth(await api.loginByUserId(await unlockWithBiometric()));
            } catch (err) {
              setError(err.message);
            } finally {
              setBusy(false);
            }
          }}>Unlock with Face or fingerprint</button>
        )}
        <Notice error={error} ok={ok} />
        <div className="form-grid" style={{ marginTop: 16 }}>
          {joining && (
            <>
              <Field label="Household join code or link" wide>
                <input name="invite" value={form.syncCode} onChange={(e) => set("syncCode", codeFromInviteText(e.target.value))} required placeholder="Paste the special code or invite link" />
              </Field>
              <Field label="Or scan the QR from an admin device" wide>
                <input type="file" accept="image/*" capture="environment" onChange={async (event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  try {
                    set("syncCode", await scanQrFromFile(file));
                    setError("");
                  } catch (err) {
                    setError(err.message);
                  }
                }} />
              </Field>
            </>
          )}
          {(creating || joining) && (
            <>
              <Field label="Your name" wide>
                <input name="name" autoComplete="name" value={form.name} onChange={(e) => set("name", e.target.value)} required />
              </Field>
              <Field label="Username" wide>
                <input name="username" autoComplete="username" value={form.username} onChange={(e) => set("username", e.target.value)} required />
              </Field>
            </>
          )}
          {view === "signin" && (
            <Field label="Username or email" wide>
              <input name="username" autoComplete="username" value={form.email} onChange={(e) => { set("email", e.target.value); set("username", e.target.value); }} required />
            </Field>
          )}
          {(creating || joining) && (
            <Field label="Email" wide>
              <input name="email" type="email" autoComplete="email" value={form.email} onChange={(e) => set("email", e.target.value)} required />
            </Field>
          )}
          <Field label={creating || joining ? "Password (10+ characters, letters and numbers)" : "Password"} wide>
            <input
              name="password"
              type="password"
              autoComplete={creating || joining ? "new-password" : "current-password"}
              value={form.password}
              onChange={(e) => set("password", e.target.value)}
              minLength={10}
              required={!form.provider}
            />
          </Field>
          {creating && (
            <>
              <Field label="Household name">
                <input name="organization" autoComplete="organization" value={form.householdName} onChange={(e) => set("householdName", e.target.value)} required />
              </Field>
              <Field label="Main currency">
                <select value={form.currency} onChange={(e) => set("currency", e.target.value)}>
                  {(boot?.currencies || CURRENCY_CODES).map((code) => <option key={code}>{code}</option>)}
                </select>
              </Field>
            </>
          )}
        </div>
        <div className="row" style={{ marginTop: 16 }}>
          <button className="btn-ghost" type="button" onClick={() => setView("home")}>Back</button>
          <button className="btn" disabled={busy}>
            {busy ? "Working…" : creating ? "Create household" : joining ? "Create member account" : "Sign in"}
          </button>
        </div>
      </form>
    </div>
  );
}

function Brand() {
  return (
    <div className="brand" style={{ marginBottom: 8 }}>
      <div className="brand-mark"><OmhMark live /></div>
      <div>
        <h1>Our Money Hub</h1>
        <p>OMH · household books</p>
      </div>
    </div>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" width="18" height="18" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 8 3.1l5.7-5.7C34.2 6.1 29.4 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.7-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7 12.9 19.6C14.7 15.2 19 12 24 12c3.1 0 5.8 1.2 8 3.1l5.7-5.7C34.2 6.1 29.4 4 24 4 16.3 4 9.6 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.3 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-1.1 3.2-3.5 5.8-6.1 7.4l6.2 5.2C38.5 37.3 44 31.7 44 24c0-1.3-.1-2.7-.4-3.5z" />
    </svg>
  );
}
