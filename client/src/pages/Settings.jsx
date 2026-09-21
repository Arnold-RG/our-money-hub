import { useEffect, useState } from "react";
import { api } from "../api.js";
import { biometricLinked, platformUnlockReady, registerBiometric } from "../biometrics.js";
import { copyText, joinUrl, shareInvite } from "../share.js";
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
  const [google, setGoogle] = useState(() => oauthConfig().google || "");
  const admin = session.user.role === "admin";
  const syncCode = admin ? (session.syncCode || api.syncCode()) : "";
  const url = session.joinUrl || (syncCode ? joinUrl(syncCode) : "");

  useEffect(() => {
    platformUnlockReady().then(setBioReady);
  }, []);

  return (
    <>
      <header className="page-head">
        <div>
          <p className="kicker">House and security</p>
          <h2>Settings</h2>
          <p className="lede">
            {admin
              ? "You manage the house, the invite, and device security. Members add and see the same books, and everyone can chat."
              : "You can add and view every household line and join the household chat. Only an admin can change the house name or send invites."}
          </p>
        </div>
      </header>
      <Notice error={error} ok={ok} />
      <section className="card-grid">
        {admin && (
          <form className="card" onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true); setError("");
            try {
              await api.household(house);
              setOk("Household details updated.");
              onRefresh?.();
            } catch (err) {
              setError(err.message);
            } finally {
              setBusy(false);
            }
          }}>
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

        {admin && (
          <article className="card">
            <h3>Invite members</h3>
            <p className="lede">Only the admin can send this. Members create their own username, email, and password, then they see and add to the same books.</p>
            <p className="hint">{url}</p>
            <textarea readOnly value={syncCode} rows={4} />
            <div className="row" style={{ marginTop: 10 }}>
              <button className="btn" type="button" onClick={async () => {
                try {
                  const how = await shareInvite({ url, code: syncCode, name: house.name });
                  setOk(how === "shared" ? "Invite sent from this device." : "Link and code copied.");
                } catch (err) {
                  setError(err.message);
                }
              }}>Send invite</button>
              <button className="btn-ghost" type="button" onClick={async () => { await copyText(url); setOk("Join link copied."); }}>Copy link</button>
              <button className="btn-ghost" type="button" onClick={async () => { await copyText(syncCode || ""); setOk("Join code copied."); }}>Copy code</button>
            </div>
          </article>
        )}

        <article className="card">
          <h3>Security stack</h3>
          <ol className="security-steps">
            <li><strong>Password</strong> — username or email, 10+ letters and numbers. The browser can store it.</li>
            <li><strong>Biometric</strong> — Face, fingerprint, or Windows Hello on this device, for every person.</li>
            <li><strong>Session</strong> — closes after 20 idle minutes, or after 8 hours. Five failed sign-ins lock the login for 15 minutes.</li>
            <li><strong>Vault</strong> — household books and chat are encrypted on this device before they sync.</li>
          </ol>
          <form onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true); setError("");
            try {
              await api.password(pass);
              setPass({ currentPassword: "", nextPassword: "" });
              setOk("Your password was changed.");
            } catch (err) {
              setError(err.message);
            } finally {
              setBusy(false);
            }
          }}>
            <div className="form-grid" style={{ marginTop: 12 }}>
              <Field label="Current password" wide>
                <input type="password" name="current-password" autoComplete="current-password" value={pass.currentPassword} onChange={(e) => setPass({ ...pass, currentPassword: e.target.value })} />
              </Field>
              <Field label="New password" wide>
                <input type="password" name="new-password" autoComplete="new-password" value={pass.nextPassword} onChange={(e) => setPass({ ...pass, nextPassword: e.target.value })} />
              </Field>
            </div>
            <button className="btn" style={{ marginTop: 14 }} disabled={busy}>Update password</button>
          </form>
          <div style={{ marginTop: 16 }}>
            {bioReady ? (
              bioOn
                ? <p className="hint">Face or fingerprint is linked on this device.</p>
                : (
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
                  }}>Add Face or fingerprint</button>
                )
            ) : (
              <p className="hint">This browser has no platform unlock. Use a phone with Face ID or a computer with Windows Hello.</p>
            )}
          </div>
        </article>

        <article className="card">
          <h3>Display</h3>
          <div className="row">
            <button className={theme === "light" ? "btn" : "btn-ghost"} type="button" onClick={() => setTheme("light")}>Light</button>
            <button className={theme === "dark" ? "btn" : "btn-ghost"} type="button" onClick={() => setTheme("dark")}>Dark</button>
          </div>
        </article>

        {admin && (
          <form className="card" onSubmit={(event) => {
            event.preventDefault();
            saveOauthConfig({ google: google.trim() });
            setOk("Google sign-in ID saved on this device.");
          }}>
            <h3>Google sign-in</h3>
            <p className="lede">Optional. A Google Cloud web client ID turns on Continue with Google for this household.</p>
            <Field label="Google client ID" wide>
              <input value={google} onChange={(e) => setGoogle(e.target.value)} placeholder="….apps.googleusercontent.com" />
            </Field>
            <button className="btn" style={{ marginTop: 14 }}>Save Google ID</button>
          </form>
        )}
      </section>
    </>
  );
}
