import { useEffect, useState } from "react";
import { api } from "../api.js";
import { Field, Modal, Notice } from "../ui.jsx";

const MODULES = [
  ["income", "Income"],
  ["expenses", "Expenses"],
  ["savings", "Savings"],
  ["projects", "Projects"],
  ["costs", "Other costs"],
  ["exchange", "Exchange"],
  ["plans", "Plans"],
  ["advisor", "Advisor"],
];

export function People({ session, onRefresh }) {
  const [members, setMembers] = useState([]);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [creating, setCreating] = useState(null);
  const [reset, setReset] = useState(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setMembers((await api.people()).members);
  }

  useEffect(() => {
    load().catch((err) => setError(err.message));
  }, []);

  async function create() {
    setBusy(true);
    setError("");
    try {
      await api.addPerson(creating);
      setCreating(null);
      setOk("Account created. They still need their own authenticator and Face or fingerprint on their device.");
      await load();
      onRefresh?.();
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
          <p className="kicker">Who may enter this house</p>
          <h2>People</h2>
          <p className="lede">This household can have more than one admin. New people usually join with the special code, invite link, or QR from an admin device. You can also add an admin, a member, or a guest here.</p>
        </div>
        <div className="row">
          <button className="btn-ghost" onClick={() => setCreating({ name: "", email: "", password: "", role: "admin", grants: {} })}>Add admin</button>
          <button className="btn-ghost" onClick={() => setCreating({ name: "", email: "", password: "", role: "member", grants: {} })}>Add member</button>
          <button className="btn" onClick={() => setCreating({ name: "", email: "", password: "", role: "guest", grants: {} })}>Invite guest</button>
        </div>
      </header>
      <Notice error={error} ok={ok} />
      <section className="card-grid">
        {members.map((person) => (
          <article className="card" key={person.id}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <h3>{person.name}</h3>
              <span className="tag copper">{person.role === "spouse" ? "member" : person.role}</span>
            </div>
            <p className="lede">{person.email}</p>
            {person.role === "guest" ? (
              <GrantEditor
                grants={person.grants}
                onSave={async (grants) => {
                  await api.updateGrants(person.id, grants);
                  setOk(`Updated access for ${person.name}.`);
                  await load();
                }}
              />
            ) : (
              <p className="lede">{person.role === "admin" ? "Admin of this household. They can invite people and manage the house." : "Full household access. No extra permission is required."}</p>
            )}
            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn-ghost" onClick={() => setReset({ id: person.id, name: person.name, password: "" })}>Reset password</button>
              {person.id !== session.user.id && (
                <button className="btn-ghost" onClick={async () => {
                  if (!window.confirm(`Remove ${person.name} from this household?`)) return;
                  await api.removePerson(person.id);
                  await load();
                  onRefresh?.();
                }}>Remove</button>
              )}
            </div>
          </article>
        ))}
      </section>

      {creating && (
        <Modal title={creating.role === "admin" ? "Add an admin" : creating.role === "member" ? "Add a member" : "Invite a guest"} onClose={() => setCreating(null)} footer={<><button className="btn-ghost" onClick={() => setCreating(null)}>Cancel</button><button className="btn" disabled={busy} onClick={create}>{busy ? "Creating…" : "Create account"}</button></>}>
          <p className="lede">
            {creating.role === "admin"
              ? "Another admin can invite people, share the QR, and manage this house."
              : creating.role === "member"
                ? "Members see and edit the household books. They still sign in with their own email, password, authenticator, and biometric."
                : "Guests cannot see household accounts until you switch on specific books."}
          </p>
          <div className="form-grid">
            <Field label="Name" wide><input value={creating.name} onChange={(e) => setCreating({ ...creating, name: e.target.value })} /></Field>
            <Field label="Email"><input type="email" value={creating.email} onChange={(e) => setCreating({ ...creating, email: e.target.value })} /></Field>
            <Field label="Password"><input type="password" value={creating.password} onChange={(e) => setCreating({ ...creating, password: e.target.value })} /></Field>
          </div>
          {creating.role === "guest" && (
            <div className="check-grid" style={{ marginTop: 12 }}>
              {MODULES.map(([key, label]) => (
                <label className="check" key={key}>
                  <input type="checkbox" checked={Boolean(creating.grants[key])} onChange={(e) => setCreating({ ...creating, grants: { ...creating.grants, [key]: e.target.checked } })} />
                  {label}
                </label>
              ))}
            </div>
          )}
        </Modal>
      )}

      {reset && (
        <Modal title={`Reset password · ${reset.name}`} onClose={() => setReset(null)} footer={<><button className="btn-ghost" onClick={() => setReset(null)}>Cancel</button><button className="btn" disabled={busy} onClick={async () => {
          setBusy(true);
          try {
            await api.resetPassword(reset.id, reset.password);
            setReset(null);
            setOk("Password updated. Their other sessions were signed out.");
          } catch (err) {
            setError(err.message);
          } finally {
            setBusy(false);
          }
        }}>Save password</button></>}>
          <Field label="New password"><input type="password" value={reset.password} onChange={(e) => setReset({ ...reset, password: e.target.value })} /></Field>
        </Modal>
      )}
    </>
  );
}

function GrantEditor({ grants, onSave }) {
  const [next, setNext] = useState({
    income: grants.income,
    expenses: grants.expenses,
    savings: grants.savings,
    projects: grants.projects,
    costs: grants.costs,
    exchange: grants.exchange,
    plans: grants.plans,
    advisor: grants.advisor,
  });
  return (
    <div>
      <div className="check-grid" style={{ marginTop: 10 }}>
        {MODULES.map(([key, label]) => (
          <label className="check" key={key}>
            <input type="checkbox" checked={Boolean(next[key])} onChange={(e) => setNext({ ...next, [key]: e.target.checked })} />
            {label}
          </label>
        ))}
      </div>
      <button className="btn-small btn" style={{ marginTop: 10 }} type="button" onClick={() => onSave(next)}>Save access</button>
    </div>
  );
}
