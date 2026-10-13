import { useState } from "react";
import { api } from "../api.js";
import { passwordProblem } from "../authRules.js";
import { copyText, downloadJson, shareInvite } from "../share.js";
import { Field, Notice } from "../ui.jsx";

export function Settings({ session, theme, setTheme, onRefresh }) {
  const [house, setHouse] = useState({
    name: session.household?.name || "",
    currency: session.household?.currency || "PLN",
  });
  const [name, setName] = useState(session.user.name || "");
  const [passwords, setPasswords] = useState({ current: "", next: "", confirm: "" });
  const [invite, setInvite] = useState(null);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [busy, setBusy] = useState(false);
  const admin = session.user.role === "admin";
  const houses = (session.houses || []).filter((row) => row.id !== session.household?.id);
  const deviceCopy = api.hasDeviceHouse();

  async function run(task) {
    setBusy(true);
    setError("");
    setOk("");
    try {
      await task();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <header className="page-head">
        <div>
          <p className="kicker">House</p>
          <h1>Settings</h1>
          <p className="lede">
            {admin
              ? "You can rename the household and issue a join code. Everyone here can write in the books and the chat."
              : "You can write in the books and the chat. An admin changes the household name and the join code."}
          </p>
        </div>
      </header>
      <Notice error={error} ok={ok} />
      <section className="card-grid">
        <form className="card" onSubmit={(event) => {
          event.preventDefault();
          run(async () => {
            await api.updateProfile(name);
            setOk("Name updated.");
            onRefresh?.();
          });
        }}>
          <h2>Your account</h2>
          <p className="lede">{session.user.email}</p>
          <Field label="Name" wide>
            <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
          </Field>
          <div className="row">
            <button className="btn" disabled={busy}>Save name</button>
            <button className="btn-ghost" type="button" disabled={busy} onClick={() => run(async () => {
              await api.logout();
              onRefresh?.();
            })}>Sign out</button>
          </div>
        </form>

        <form className="card" onSubmit={(event) => {
          event.preventDefault();
          run(async () => {
            if (passwords.next !== passwords.confirm) throw new Error("Those passwords don’t match.");
            const problem = passwordProblem(passwords.next, session.user.email);
            if (problem) throw new Error(problem);
            await api.updatePassword(passwords);
            setPasswords({ current: "", next: "", confirm: "" });
            setOk("Password updated.");
          });
        }}>
          <h2>Password</h2>
          <p className="lede">Your current password is required. The new one needs 10 characters, with letters and numbers.</p>
          <Field label="Current password" wide>
            <input type="password" autoComplete="current-password" value={passwords.current} onChange={(e) => setPasswords({ ...passwords, current: e.target.value })} required />
          </Field>
          <Field label="New password" wide>
            <input type="password" autoComplete="new-password" minLength={10} maxLength={72} value={passwords.next} onChange={(e) => setPasswords({ ...passwords, next: e.target.value })} required />
          </Field>
          <Field label="Confirm new password" wide>
            <input type="password" autoComplete="new-password" minLength={10} maxLength={72} value={passwords.confirm} onChange={(e) => setPasswords({ ...passwords, confirm: e.target.value })} required />
          </Field>
          <button className="btn" disabled={busy}>Update password</button>
        </form>

        {admin && (
          <form className="card" onSubmit={(event) => {
            event.preventDefault();
            run(async () => {
              await api.household(house);
              setOk("Household details updated.");
              onRefresh?.();
            });
          }}>
            <h2>Household</h2>
            <Field label="Name" wide>
              <input value={house.name} onChange={(e) => setHouse({ ...house, name: e.target.value })} />
            </Field>
            <Field label="Main currency" wide>
              <select value={house.currency} onChange={(e) => setHouse({ ...house, currency: e.target.value })}>
                {(session.catalogs?.currencies || ["PLN"]).map((code) => <option key={code}>{code}</option>)}
              </select>
            </Field>
            <button className="btn" disabled={busy}>Save household</button>
          </form>
        )}

        {admin && (
          <article className="card">
            <h2>Invite</h2>
            <p className="lede">A new code replaces the previous one. People create their own account, then paste the code.</p>
            {invite && (
              <>
                <p className="hint">{invite.url}</p>
                <textarea readOnly rows={3} spellCheck={false} value={invite.code} />
              </>
            )}
            <div className="row">
              <button className="btn" type="button" disabled={busy} onClick={() => run(async () => {
                const next = await api.rotateInvite();
                setInvite(next);
                setOk("New join code ready. The previous one no longer works.");
              })}>{invite ? "Issue another code" : "Issue a join code"}</button>
              {invite && (
                <>
                  <button className="btn-ghost" type="button" onClick={async () => {
                    try {
                      const how = await shareInvite({ url: invite.url, code: invite.code, name: house.name });
                      setOk(how === "shared" ? "Invite sent." : "Link and code copied.");
                    } catch (err) {
                      setError(err.message);
                    }
                  }}>Send invite</button>
                  <button className="btn-ghost" type="button" onClick={async () => { await copyText(invite.code); setOk("Join code copied."); }}>Copy code</button>
                </>
              )}
            </div>
          </article>
        )}

        {houses.length > 0 && (
          <article className="card">
            <h2>Other households</h2>
            <div className="home-actions">
              {houses.map((row) => (
                <button key={row.id} className="btn-ghost" type="button" disabled={busy} onClick={() => run(async () => {
                  await api.switchHouse(row.id);
                  onRefresh?.();
                })}>Open {row.name}</button>
              ))}
            </div>
          </article>
        )}

        <article className="card">
          <h2>A copy of the books</h2>
          <p className="lede">The file contains names and amounts from this household. Keep it private.</p>
          <button className="btn-ghost" type="button" disabled={busy} onClick={() => run(async () => {
            const data = await api.exportData();
            const slug = String(house.name || "household").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "household";
            downloadJson(`omh-${slug}.json`, data);
            setOk("Books downloaded.");
          })}>Download the books</button>
        </article>

        {deviceCopy && (
          <article className="card">
            <h2>Books saved on this device</h2>
            <p className="lede">An older copy of a household may still be in this browser. Bringing it in adds those lines to the household you’re in now. Chat is left behind. Pots come in at their current balance.</p>
            <div className="row">
              {admin && (
                <button className="btn" type="button" disabled={busy} onClick={() => run(async () => {
                  if (!window.confirm("Bring the device copy into this household?")) return;
                  await api.importDeviceHouse();
                  setOk("The device copy is in this household.");
                  onRefresh?.();
                })}>Bring it in</button>
              )}
              <button className="btn-ghost" type="button" disabled={busy} onClick={() => run(async () => {
                if (!window.confirm("Remove the household copy stored in this browser?")) return;
                api.forgetDevice();
                setOk("The device copy was removed.");
                onRefresh?.();
              })}>Remove device copy</button>
            </div>
          </article>
        )}

        <article className="card">
          <h2>Display</h2>
          <div className="row">
            {[["light", "Light"], ["dark", "Dark"], ["system", "Match this device"]].map(([id, label]) => (
              <button key={id} className={theme === id ? "btn" : "btn-ghost"} type="button" aria-pressed={theme === id} onClick={() => setTheme(id)}>{label}</button>
            ))}
          </div>
        </article>
      </section>
    </>
  );
}
