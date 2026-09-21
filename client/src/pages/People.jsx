import { useEffect, useState } from "react";
import { api } from "../api.js";
import { Field, Modal, Notice } from "../ui.jsx";

export function People({ session, onRefresh }) {
  const [members, setMembers] = useState([]);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [reset, setReset] = useState(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setMembers((await api.people()).members);
  }

  useEffect(() => {
    load().catch((err) => setError(err.message));
  }, []);

  return (
    <>
      <header className="page-head">
        <div>
          <p className="kicker">This household</p>
          <h2>People</h2>
          <p className="lede">Admins send the invite from Settings. Every member creates their own login, then adds and sees the same household books.</p>
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
            <p className="lede">{person.username ? `@${person.username} · ` : ""}{person.email}</p>
            <p className="lede">{person.role === "admin" ? "Admin · invite and house settings." : "Member · add and view every household line."}</p>
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

      {reset && (
        <Modal title={`Reset password · ${reset.name}`} onClose={() => setReset(null)} footer={<><button className="btn-ghost" onClick={() => setReset(null)}>Cancel</button><button className="btn" disabled={busy} onClick={async () => {
          setBusy(true);
          try {
            await api.resetPassword(reset.id, reset.password);
            setReset(null);
            setOk("Password updated.");
          } catch (err) {
            setError(err.message);
          } finally {
            setBusy(false);
          }
        }}>Save password</button></>}>
          <Field label="New password"><input type="password" autoComplete="new-password" value={reset.password} onChange={(e) => setReset({ ...reset, password: e.target.value })} /></Field>
        </Modal>
      )}
    </>
  );
}
