import { useState } from "react";
import { api } from "../api.js";
import { copyText, joinUrl, shareInvite } from "../share.js";
import { Field, Notice } from "../ui.jsx";

export function Settings({ session, theme, setTheme, onRefresh }) {
  const [house, setHouse] = useState({
    name: session.household?.name || "",
    currency: session.household?.currency || "PLN",
  });
  const [who, setWho] = useState(session.user.id);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [busy, setBusy] = useState(false);
  const admin = session.user.role === "admin";
  const syncCode = admin ? (session.syncCode || api.syncCode()) : "";
  const url = session.joinUrl || (syncCode ? joinUrl(syncCode) : "");
  const people = (session.members || []).filter((row) => row.role !== "guest");
  const houses = session.houses || [];

  return (
    <>
      <header className="page-head">
        <div>
          <p className="kicker">House</p>
          <h2>Settings</h2>
          <p className="lede">
            {admin
              ? "You manage the house name and the invite. Everyone in the house can add and see the same books, and chat together."
              : "You can add and view every household line and join the household chat. Only an admin can change the house name or send invites."}
          </p>
        </div>
      </header>
      <Notice error={error} ok={ok} />
      <section className="card-grid">
        <article className="card">
          <h3>Who you are</h3>
          <p className="lede">Pick the name you use in this household.</p>
          <div className="form-grid" style={{ marginTop: 12 }}>
            <Field label="Using this house as" wide>
              <select value={who} onChange={(e) => setWho(e.target.value)}>
                {people.map((row) => <option key={row.id} value={row.id}>{row.name}{row.role === "admin" ? " · admin" : ""}</option>)}
              </select>
            </Field>
          </div>
          <button className="btn" style={{ marginTop: 14 }} disabled={busy} type="button" onClick={async () => {
            setBusy(true); setError("");
            try {
              await api.become(who);
              setOk("This device now uses that name.");
              onRefresh?.();
            } catch (err) {
              setError(err.message);
            } finally {
              setBusy(false);
            }
          }}>Use this name</button>
        </article>

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
            <p className="lede">Only the admin can send this. People open the link or paste the code and add their name.</p>
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

        {houses.length > 1 && (
          <article className="card">
            <h3>Other households on this device</h3>
            <div className="home-actions" style={{ marginTop: 12 }}>
              {houses.filter((row) => row.id !== session.household?.id).map((row) => (
                <button key={row.id} className="btn-ghost" type="button" disabled={busy} onClick={async () => {
                  setBusy(true); setError("");
                  try {
                    await api.switchHouse(row.id);
                    onRefresh?.();
                  } catch (err) {
                    setError(err.message);
                  } finally {
                    setBusy(false);
                  }
                }}>Open {row.name}</button>
              ))}
            </div>
          </article>
        )}

        <article className="card">
          <h3>Display</h3>
          <div className="row">
            <button className={theme === "light" ? "btn" : "btn-ghost"} type="button" onClick={() => setTheme("light")}>Light</button>
            <button className={theme === "dark" ? "btn" : "btn-ghost"} type="button" onClick={() => setTheme("dark")}>Dark</button>
          </div>
        </article>
      </section>
    </>
  );
}
