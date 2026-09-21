import { useEffect, useState } from "react";
import { api } from "../api.js";
import { biometricLinked, platformUnlockReady, registerBiometric } from "../biometrics.js";
import { joinUrl, qrDataUrl } from "../share.js";
import { oauthConfig, saveOauthConfig } from "../social.js";
import { Field, Notice } from "../ui.jsx";

export function Settings({ session, theme, setTheme, onRefresh }) {
  const [house, setHouse] = useState({
    name: session.household?.name || "",
    currency: session.household?.currency || "PLN",
  });
  const [pass, setPass] = useState({ currentPassword: "", nextPassword: "" });
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [busy, setBusy] = useState(false);
  const [bioReady, setBioReady] = useState(false);
  const [bioOn, setBioOn] = useState(() => biometricLinked(session.user.id));
  const [qr, setQr] = useState("");
  const [oauth, setOauth] = useState(() => oauthConfig());
  const [nextHouse, setNextHouse] = useState({
    name: session.user.name,
    email: session.user.email,
    password: "",
    householdName: "",
    currency: "PLN",
  });
  const syncCode = session.syncCode || api.syncCode();
  const url = session.joinUrl || (syncCode ? joinUrl(syncCode) : "");
  const houses = session.houses || [];

  useEffect(() => {
    platformUnlockReady().then(setBioReady);
  }, []);

  useEffect(() => {
    if (!url) return;
    qrDataUrl(url).then(setQr).catch(() => setQr(""));
  }, [url]);

  async function saveHouse(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api.household(house);
      setOk("Household details updated.");
      onRefresh?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function savePass(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api.password(pass);
      setPass({ currentPassword: "", nextPassword: "" });
      setOk("Your password was changed.");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function download() {
    const data = await api.exportData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = "omh-household-export.json";
    a.click();
    URL.revokeObjectURL(objectUrl);
  }

  return (
    <>
      <header className="page-head">
        <div>
          <p className="kicker">The house itself</p>
          <h2>Settings</h2>
          <p className="lede">Polish złoty is the household currency unless you change it. Share the code, link, or QR only with people who should join this house.</p>
        </div>
      </header>
      <Notice error={error} ok={ok} />
      <section className="card-grid">
        {session.grants.settings && (
          <form className="card" onSubmit={saveHouse}>
            <h3>Household</h3>
            <div className="form-grid" style={{ marginTop: 12 }}>
              <Field label="Name" wide>
                <input value={house.name} onChange={(e) => setHouse({ ...house, name: e.target.value })} />
              </Field>
              <Field label="Main currency" wide>
                <select value={house.currency} onChange={(e) => setHouse({ ...house, currency: e.target.value })}>
                  {(session.catalogs?.currencies || ["PLN"]).map((code) => <option key={code}>{code}</option>)}
                </select>
              </Field>
            </div>
            <button className="btn" style={{ marginTop: 14 }} disabled={busy}>Save household</button>
          </form>
        )}

        {session.grants.settings && (
          <article className="card">
            <h3>Invite this household</h3>
            <p className="lede">Members join with this special code, the link, or by scanning the QR on this admin device. They still create their own login.</p>
            {qr && <img className="invite-qr" src={qr} alt="Household join QR code" />}
            <p className="hint">{url}</p>
            <textarea readOnly value={syncCode} rows={4} />
            <div className="row" style={{ marginTop: 10 }}>
              <button className="btn-ghost" type="button" onClick={() => navigator.clipboard.writeText(syncCode || "")}>Copy code</button>
              <button className="btn-ghost" type="button" onClick={() => navigator.clipboard.writeText(url)}>Copy link</button>
            </div>
          </article>
        )}

        {houses.length > 0 && (
          <article className="card">
            <h3>Households on this device</h3>
            <p className="lede">Open another house you already created or joined here.</p>
            <div className="list">
              {houses.map((item) => (
                <div className="list-item" key={item.id}>
                  <div>
                    <strong>{item.name}</strong>
                    {item.id === session.household?.id ? <p className="hint">Open now</p> : null}
                  </div>
                  {item.id !== session.household?.id && (
                    <button className="btn-ghost" type="button" onClick={async () => {
                      setBusy(true); setError("");
                      try {
                        await api.switchHouse(item.id);
                        setOk(`Opened ${item.name}.`);
                        onRefresh?.();
                      } catch (err) {
                        setError(err.message);
                      } finally {
                        setBusy(false);
                      }
                    }}>Open</button>
                  )}
                </div>
              ))}
            </div>
          </article>
        )}

        <form className="card" onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true); setError("");
          try {
            await api.setup(nextHouse);
            setOk("A new household is open on this device.");
            onRefresh?.();
          } catch (err) {
            setError(err.message);
          } finally {
            setBusy(false);
          }
        }}>
          <h3>Create another household</h3>
          <p className="lede">Anyone can open their own house. This does not replace the house you are in; both stay on this device.</p>
          <div className="form-grid" style={{ marginTop: 12 }}>
            <Field label="Your name"><input value={nextHouse.name} onChange={(e) => setNextHouse({ ...nextHouse, name: e.target.value })} required /></Field>
            <Field label="Email"><input type="email" value={nextHouse.email} onChange={(e) => setNextHouse({ ...nextHouse, email: e.target.value })} required /></Field>
            <Field label="Password" wide><input type="password" value={nextHouse.password} onChange={(e) => setNextHouse({ ...nextHouse, password: e.target.value })} required /></Field>
            <Field label="New household name" wide><input value={nextHouse.householdName} onChange={(e) => setNextHouse({ ...nextHouse, householdName: e.target.value })} required /></Field>
          </div>
          <button className="btn" style={{ marginTop: 14 }} disabled={busy}>Create household</button>
        </form>

        <form className="card" onSubmit={savePass}>
          <h3>Your password</h3>
          <p className="lede">At least 10 characters, with letters and numbers. Sessions close after 20 idle minutes.</p>
          <div className="form-grid" style={{ marginTop: 12 }}>
            <Field label="Current" wide>
              <input type="password" value={pass.currentPassword} onChange={(e) => setPass({ ...pass, currentPassword: e.target.value })} autoComplete="current-password" />
            </Field>
            <Field label="New password" wide>
              <input type="password" value={pass.nextPassword} onChange={(e) => setPass({ ...pass, nextPassword: e.target.value })} autoComplete="new-password" />
            </Field>
          </div>
          <button className="btn" style={{ marginTop: 14 }} disabled={busy}>Update password</button>
        </form>

        <article className="card">
          <h3>Authenticator app</h3>
          <p className="lede">Google Authenticator, Authy, or Microsoft Authenticator is required to sign in. This account {session.user.account?.totpOn ? "already has an authenticator linked." : "still needs an authenticator before the books stay open."}</p>
        </article>

        <article className="card">
          <h3>Display</h3>
          <p className="lede">Ivory ledger by day. Midnight gold after dark.</p>
          <div className="row">
            <button className={theme === "light" ? "btn" : "btn-ghost"} type="button" onClick={() => setTheme("light")}>Light</button>
            <button className={theme === "dark" ? "btn" : "btn-ghost"} type="button" onClick={() => setTheme("dark")}>Dark</button>
            <button className="btn-ghost" type="button" onClick={() => {
              sessionStorage.removeItem("omh.intro");
              window.location.reload();
            }}>Play opening again</button>
          </div>
        </article>

        <article className="card">
          <h3>Face, fingerprint, or Windows Hello</h3>
          <p className="lede">A biometric unlock is required on each device before the household books open.</p>
          {bioReady ? (
            <div className="row">
              {!bioOn && (
                <button className="btn" type="button" disabled={busy} onClick={async () => {
                  setBusy(true); setError("");
                  try {
                    await registerBiometric(session.user);
                    await api.markBiometric();
                    setBioOn(true);
                    setOk("Biometric unlock is on for this device.");
                  } catch (err) {
                    setError(err.message);
                  } finally {
                    setBusy(false);
                  }
                }}>Turn on biometric unlock</button>
              )}
              {bioOn && <p className="hint">Face or fingerprint is linked on this device.</p>}
            </div>
          ) : (
            <p className="hint">This browser does not expose a platform authenticator. Try Safari or Chrome on a phone with Face ID or a computer with Windows Hello.</p>
          )}
        </article>

        {session.grants.settings && (
          <form className="card" onSubmit={(event) => {
            event.preventDefault();
            saveOauthConfig({
              google: oauth.google || "",
              apple: oauth.apple || "",
              facebook: oauth.facebook || "",
              microsoft: oauth.microsoft || "",
            });
            setOk("Social sign-in IDs were saved on this device.");
          }}>
            <h3>Google, Apple, Facebook, and more</h3>
            <p className="lede">Optional. Add app IDs from each provider so household members can tap Continue with that account. Without an ID, they still sign up with that email plus an Our Money Hub password.</p>
            <div className="form-grid" style={{ marginTop: 12 }}>
              <Field label="Google client ID" wide><input value={oauth.google || ""} onChange={(e) => setOauth({ ...oauth, google: e.target.value })} /></Field>
              <Field label="Apple client ID" wide><input value={oauth.apple || ""} onChange={(e) => setOauth({ ...oauth, apple: e.target.value })} /></Field>
              <Field label="Facebook app ID" wide><input value={oauth.facebook || ""} onChange={(e) => setOauth({ ...oauth, facebook: e.target.value })} /></Field>
              <Field label="Microsoft client ID" wide><input value={oauth.microsoft || ""} onChange={(e) => setOauth({ ...oauth, microsoft: e.target.value })} /></Field>
            </div>
            <button className="btn" style={{ marginTop: 14 }}>Save social IDs</button>
          </form>
        )}

        {session.grants.settings && (
          <article className="card">
            <h3>Keep a copy</h3>
            <p className="lede">Download the household books as JSON. Password hashes stay in the vault; this file is for your records.</p>
            <button className="btn-ghost" type="button" onClick={download}>Export household data</button>
          </article>
        )}
      </section>
    </>
  );
}
