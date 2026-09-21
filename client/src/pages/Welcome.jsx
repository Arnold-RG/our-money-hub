import { useEffect, useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { api } from "../api.js";
import { CURRENCY_CODES } from "../catalogs.js";
import { otpauthUrl } from "../totp.js";
import { codeFromInviteText, joinUrl, qrDataUrl, scanQrFromFile } from "../share.js";
import { signInSocial, SOCIAL_PROVIDERS } from "../social.js";
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
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    name: "",
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
      }));
    }
  }, [boot?.user]);

  useEffect(() => {
    if (boot?.needsTotp && boot.totpSecret) {
      setTotpSecret(boot.totpSecret);
      setView("totp");
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
    if (result.needsTotp && !secret) {
      setView("totp-login");
      return;
    }
    if (secret && view !== "totp-login") {
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
      const result = await api.setup(form);
      await afterAuth(result);
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
      const result = await api.join(form);
      await afterAuth(result);
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
      if (result.needsTotp) {
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

  async function social(id) {
    setBusy(true);
    setError("");
    try {
      const identity = await signInSocial(id);
      setForm((prev) => ({ ...prev, name: identity.name, email: identity.email, provider: identity }));
      if (view === "join") {
        await afterAuth(await api.join({ ...form, name: identity.name, email: identity.email, provider: identity }));
      } else if (view === "signin") {
        const result = await api.loginSocial(identity);
        if (!result.linked && view === "signin") {
          setView("create");
          return;
        }
        await afterAuth(result);
      } else {
        setView("create");
      }
    } catch (err) {
      if (String(err.message).includes("_SETUP")) {
        setForm((prev) => ({ ...prev, provider: { provider: id, subject: "email", email: "", name: "" } }));
        setError(`Use your ${id} email and a password for Our Money Hub. Full ${id} sign-in can be switched on later in Settings with a client ID.`);
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
      if (view === "totp-login") {
        await api.verifyLoginTotp(form.totpCode);
      } else {
        await api.confirmTotp(form.totpCode);
      }
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
      const session = who || boot?.user || { id: "pending", email: form.email, name: form.name };
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

  const socialRow = (
    <div className="social-grid">
      {SOCIAL_PROVIDERS.map((item) => (
        <button key={item.id} type="button" className="btn-ghost social-btn" disabled={busy} onClick={() => social(item.id)}>
          Continue with {item.label}
        </button>
      ))}
    </div>
  );

  if (view === "home") {
    return (
      <div className="auth-wrap">
        <div className="auth-card">
          <Brand />
          <h2>Every household can open its own books.</h2>
          <p className="lede">Create a house, or join one with a special code, invite link, or QR from an admin’s device. There is no single master account for the whole app.</p>
          <div className="home-actions">
            <button className="btn" onClick={() => setView("create")}>Create a household</button>
            <button className="btn-ghost" onClick={() => setView("join")}>Join with a code</button>
            <button className="btn-ghost" onClick={() => setView("signin")}>Sign in</button>
          </div>
        </div>
      </div>
    );
  }

  if (view === "invite") {
    return (
      <div className="auth-wrap">
        <div className="auth-card">
          <Brand />
          <h2>Invite the rest of the house.</h2>
          <p className="lede">Share the code, the link, or this QR from this device. Anyone who joins still creates their own email, password, biometric, and authenticator.</p>
          {invite.qr && <img className="invite-qr" src={invite.qr} alt="Household join QR code" />}
          <p className="hint">{invite.url}</p>
          <textarea readOnly value={invite.code} rows={3} />
          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn-ghost" type="button" onClick={() => navigator.clipboard.writeText(invite.code)}>Copy code</button>
            <button className="btn-ghost" type="button" onClick={() => navigator.clipboard.writeText(invite.url)}>Copy link</button>
            <button className="btn" type="button" onClick={onDone}>Enter the household</button>
          </div>
        </div>
      </div>
    );
  }

  if (view === "totp" || view === "totp-login") {
    return (
      <div className="auth-wrap">
        <form className="auth-card" onSubmit={confirmTotp}>
          <Brand />
          <h2>Authenticator app</h2>
          <p className="lede">Scan this with Google Authenticator, Authy, or Microsoft Authenticator, then enter the 6-digit code. This is required before the books open.</p>
          {totpQr && view === "totp" ? <img className="invite-qr" src={totpQr} alt="Authenticator QR" /> : null}
          {totpSecret && view === "totp" ? <p className="hint">Secret: {totpSecret}</p> : null}
          <Notice error={error} />
          <Field label="6-digit code" wide>
            <input inputMode="numeric" value={form.totpCode} onChange={(e) => set("totpCode", e.target.value)} required />
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
          <h2>Face or fingerprint is required</h2>
          <p className="lede">This device must save Face ID, Touch ID, Windows Hello, or a fingerprint before you can use the household books.</p>
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
      <form className="auth-card" onSubmit={creating ? create : joining ? join : signin}>
        <Brand />
        <h2>{creating ? "Create your household" : joining ? "Join a household" : "Sign in"}</h2>
        <p className="lede">
          {creating
            ? "You become an admin of this house. Other people can also create their own houses. Members join with a special code."
            : joining
              ? "Paste the household code, or open the invite link / QR from an admin device. Then add your own login."
              : "Use email and password, a social account, then your authenticator and biometric."}
        </p>
        {socialRow}
        {view === "signin" && hasBiometricForDevice() && (
          <button className="btn bio-btn" type="button" disabled={busy} onClick={async () => {
            setBusy(true); setError("");
            try {
              const userId = await unlockWithBiometric();
              await afterAuth(await api.loginByUserId(userId));
            } catch (err) {
              setError(err.message);
            } finally {
              setBusy(false);
            }
          }}>Unlock with Face or fingerprint</button>
        )}
        <Notice error={error} />
        <div className="form-grid" style={{ marginTop: 16 }}>
          {joining && (
            <>
              <Field label="Household join code" wide>
                <input value={form.syncCode} onChange={(e) => set("syncCode", codeFromInviteText(e.target.value))} required placeholder="Paste the special code or invite link" />
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
            <Field label="Your name" wide>
              <input value={form.name} onChange={(e) => set("name", e.target.value)} required />
            </Field>
          )}
          <Field label="Email" wide>
            <input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} required />
          </Field>
          <Field label="Password (10+ characters, letters and numbers)" wide>
            <input type="password" value={form.password} onChange={(e) => set("password", e.target.value)} minLength={10} required={!form.provider} />
          </Field>
          {creating && (
            <>
              <Field label="Household name">
                <input value={form.householdName} onChange={(e) => set("householdName", e.target.value)} required />
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
            {busy ? "Working…" : creating ? "Create household" : joining ? "Join household" : "Sign in"}
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
