import { useState } from "react";
import { api } from "../api.js";
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
  const syncCode = session.syncCode || api.syncCode();

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
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "omh-household-export.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <header className="page-head">
        <div>
          <p className="kicker">The house itself</p>
          <h2>Settings</h2>
          <p className="lede">Polish złoty is the household currency unless you change it. Keep the join code private.</p>
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
          <h3>Display</h3>
          <p className="lede">Ivory ledger by day. Midnight gold after dark.</p>
          <div className="row">
            <button className={theme === "light" ? "btn" : "btn-ghost"} type="button" onClick={() => setTheme("light")}>Light</button>
            <button className={theme === "dark" ? "btn" : "btn-ghost"} type="button" onClick={() => setTheme("dark")}>Dark</button>
          </div>
        </article>

        {session.grants.settings && (
          <article className="card">
            <h3>Partner join code</h3>
            <p className="lede">Your partner opens the live site, chooses Join household, and pastes this code with the email and password you created for them.</p>
            <textarea readOnly value={syncCode} rows={4} />
            <div className="row" style={{ marginTop: 10 }}>
              <button className="btn-ghost" type="button" onClick={() => navigator.clipboard.writeText(syncCode || "")}>Copy code</button>
            </div>
          </article>
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
