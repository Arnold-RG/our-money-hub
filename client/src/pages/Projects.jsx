import { useEffect, useState } from "react";
import { api } from "../api.js";
import { money, pct, prettyDate, today } from "../format.js";
import { Empty, Field, Modal, Notice, Progress } from "../ui.jsx";

export function Projects({ session }) {
  const [items, setItems] = useState([]);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(null);
  const [spend, setSpend] = useState(null);
  const [busy, setBusy] = useState(false);
  const currency = session.household?.currency || "PLN";
  const members = session.members.filter((m) => m.role !== "guest");

  async function load() {
    setItems((await api.projects()).items);
  }

  useEffect(() => {
    load().catch((err) => setError(err.message));
  }, []);

  async function save() {
    setBusy(true);
    setError("");
    try {
      const body = {
        name: editing.name,
        budget: Number(editing.budget || 0),
        status: editing.status,
        targetDate: editing.targetDate || null,
        notes: editing.notes,
        ownerId: editing.ownerId || session.user.id,
      };
      if (editing.id) await api.updateProject(editing.id, body);
      else await api.addProject(body);
      setEditing(null);
      await load();
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
          <p className="kicker">The longer view</p>
          <h2>Life projects</h2>
          <p className="lede">A wedding, a house, school, a trip home — any member can open a project. Everyone sees the spend.</p>
        </div>
        <button className="btn" onClick={() => setEditing({ name: "", budget: "", status: "planned", targetDate: "", notes: "", ownerId: session.user.id })}>New project</button>
      </header>
      <Notice error={error} />
      {items.length === 0 ? (
        <div className="card">
          <Empty title="No life projects yet" text="Start with the one you keep talking about at the table." action={<button className="btn" onClick={() => setEditing({ name: "", budget: "", status: "planned", targetDate: "", notes: "", ownerId: session.user.id })}>New project</button>} />
        </div>
      ) : (
        <section className="card-grid">
          {items.map((row) => {
            const left = row.budget_cents - row.spent_cents;
            return (
              <article className="card" key={row.id}>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <h3>{row.name}</h3>
                  <span className={`tag ${row.status === "active" ? "copper" : "gold"}`}>{row.status}</span>
                </div>
                <div className="money" style={{ margin: "10px 0 8px" }}>{money(row.spent_cents, currency)}</div>
                <Progress value={pct(row.spent_cents, row.budget_cents || 1)} />
                <p className="lede">
                  Budget {money(row.budget_cents, currency)} · {left >= 0 ? `${money(left, currency)} left` : `${money(Math.abs(left), currency)} over`}
                  {row.target_date ? ` · ${prettyDate(row.target_date)}` : ""}
                </p>
                <p className="lede">{row.owner_name}{row.notes ? ` · ${row.notes}` : ""}</p>
                <div className="row" style={{ marginTop: 12 }}>
                  <button className="btn" onClick={() => setSpend({ id: row.id, name: row.name, amount: "", date: today(), notes: "" })}>Log spend</button>
                  <button className="btn-ghost" onClick={() => setEditing({
                    id: row.id, name: row.name, budget: row.budget_cents / 100, status: row.status,
                    targetDate: row.target_date || "", notes: row.notes || "", ownerId: row.owner_id,
                  })}>Edit</button>
                  <button className="btn-ghost" onClick={async () => {
                    if (window.confirm("Remove this project?")) {
                      await api.deleteProject(row.id);
                      await load();
                    }
                  }}>Remove</button>
                </div>
                {row.entries?.length ? (
                  <div className="list" style={{ marginTop: 12 }}>
                    {row.entries.slice(0, 4).map((entry) => (
                      <div className="list-item" key={entry.id}>
                        <span>{prettyDate(entry.entry_on)} · {entry.created_by_name}</span>
                        <strong>{money(entry.amount_cents, currency)}</strong>
                      </div>
                    ))}
                  </div>
                ) : null}
              </article>
            );
          })}
        </section>
      )}

      {editing && (
        <Modal title={editing.id ? "Edit project" : "New life project"} onClose={() => setEditing(null)} footer={<><button className="btn-ghost" onClick={() => setEditing(null)}>Cancel</button><button className="btn" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save"}</button></>}>
          <div className="form-grid">
            <Field label="Project name" wide><input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></Field>
            <Field label="Budget"><input type="number" min="0" step="0.01" value={editing.budget} onChange={(e) => setEditing({ ...editing, budget: e.target.value })} /></Field>
            <Field label="Status">
              <select value={editing.status} onChange={(e) => setEditing({ ...editing, status: e.target.value })}>
                <option value="planned">Planned</option>
                <option value="active">Active</option>
                <option value="paused">Paused</option>
                <option value="done">Done</option>
              </select>
            </Field>
            <Field label="Target date"><input type="date" value={editing.targetDate} onChange={(e) => setEditing({ ...editing, targetDate: e.target.value })} /></Field>
            <Field label="Lead">
              <select value={editing.ownerId} onChange={(e) => setEditing({ ...editing, ownerId: e.target.value })}>
                {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </Field>
            <Field label="Notes" wide><textarea value={editing.notes} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} /></Field>
          </div>
        </Modal>
      )}

      {spend && (
        <Modal title={`Log spend · ${spend.name}`} onClose={() => setSpend(null)} footer={<><button className="btn-ghost" onClick={() => setSpend(null)}>Cancel</button><button className="btn" disabled={busy} onClick={async () => {
          setBusy(true);
          try {
            await api.projectEntry(spend.id, { amount: Number(spend.amount), date: spend.date, notes: spend.notes });
            setSpend(null);
            await load();
          } catch (err) {
            setError(err.message);
          } finally {
            setBusy(false);
          }
        }}>{busy ? "Saving…" : "Save spend"}</button></>}>
          <div className="form-grid">
            <Field label="Amount"><input type="number" min="0" step="0.01" value={spend.amount} onChange={(e) => setSpend({ ...spend, amount: e.target.value })} /></Field>
            <Field label="Date"><input type="date" value={spend.date} onChange={(e) => setSpend({ ...spend, date: e.target.value })} /></Field>
            <Field label="What for" wide><input value={spend.notes} onChange={(e) => setSpend({ ...spend, notes: e.target.value })} /></Field>
          </div>
        </Modal>
      )}
    </>
  );
}
