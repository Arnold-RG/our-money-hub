import { useEffect, useState } from "react";
import { api } from "../api.js";
import { money, pct, prettyDate, today } from "../format.js";
import { Empty, Field, Modal, Notice, Progress } from "../ui.jsx";

export function Savings({ session }) {
  const [items, setItems] = useState([]);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(null);
  const [move, setMove] = useState(null);
  const [busy, setBusy] = useState(false);
  const currency = session.household?.currency || "PLN";
  const members = session.members.filter((m) => m.role !== "guest");

  async function load() {
    const payload = await api.savings();
    setItems(payload.items);
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
        target: Number(editing.target || 0),
        current: Number(editing.current || 0),
        monthly: Number(editing.monthly || 0),
        targetDate: editing.targetDate || null,
        notes: editing.notes,
        ownerId: Number(editing.ownerId),
      };
      if (editing.id) await api.updateSavings(editing.id, body);
      else await api.addSavings(body);
      setEditing(null);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function applyMove() {
    setBusy(true);
    try {
      await api.savingsEntry(move.id, {
        amount: Number(move.amount),
        kind: move.kind,
        date: move.date,
        notes: move.notes,
      });
      setMove(null);
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
          <p className="kicker">Kept aside</p>
          <h2>Savings</h2>
          <p className="lede">Emergency funds, school, a home, a trip — each pot is visible to both of you.</p>
        </div>
        <button className="btn" onClick={() => setEditing({ name: "", target: "", current: "", monthly: "", targetDate: "", notes: "", ownerId: session.user.id })}>New pot</button>
      </header>
      <Notice error={error} />
      {items.length === 0 ? (
        <div className="card">
          <Empty title="No savings pots yet" text="Open the first one and start moving money toward a named goal." action={<button className="btn" onClick={() => setEditing({ name: "", target: "", current: "", monthly: "", targetDate: "", notes: "", ownerId: session.user.id })}>New pot</button>} />
        </div>
      ) : (
        <section className="card-grid">
          {items.map((row) => {
            const monthsLeft = row.monthly_cents > 0 && row.target_cents > row.current_cents
              ? Math.ceil((row.target_cents - row.current_cents) / row.monthly_cents)
              : null;
            return (
              <article className="card" key={row.id}>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <h3>{row.name}</h3>
                  <span className="owner-pill">{row.owner_name}</span>
                </div>
                <div className="money" style={{ margin: "10px 0 8px" }}>{money(row.current_cents, currency)}</div>
                <Progress value={pct(row.current_cents, row.target_cents || 1)} />
                <p className="lede">Goal {money(row.target_cents, currency)}{row.target_date ? ` by ${prettyDate(row.target_date)}` : ""}{monthsLeft ? ` · about ${monthsLeft} months at the planned pace` : ""}</p>
                {row.notes ? <p className="lede">{row.notes}</p> : null}
                <div className="row" style={{ marginTop: 12 }}>
                  <button className="btn" onClick={() => setMove({ id: row.id, name: row.name, amount: "", kind: "deposit", date: today(), notes: "" })}>Move money</button>
                  <button className="btn-ghost" onClick={() => setEditing({
                    id: row.id, name: row.name, target: row.target_cents / 100, monthly: row.monthly_cents / 100,
                    targetDate: row.target_date || "", notes: row.notes || "", ownerId: row.owner_id,
                  })}>Edit</button>
                  <button className="btn-ghost" onClick={async () => {
                    if (window.confirm("Remove this savings pot?")) {
                      await api.deleteSavings(row.id);
                      await load();
                    }
                  }}>Remove</button>
                </div>
                {row.entries?.length ? (
                  <div className="list" style={{ marginTop: 14 }}>
                    {row.entries.slice(0, 4).map((entry) => (
                      <div className="list-item" key={entry.id}>
                        <span>{entry.kind} · {entry.created_by_name}</span>
                        <strong>{entry.kind === "withdraw" ? "−" : "+"}{money(entry.amount_cents, currency)}</strong>
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
        <Modal title={editing.id ? "Edit pot" : "New savings pot"} onClose={() => setEditing(null)} footer={<><button className="btn-ghost" onClick={() => setEditing(null)}>Cancel</button><button className="btn" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save"}</button></>}>
          <div className="form-grid">
            <Field label="Name" wide><input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></Field>
            <Field label="Target"><input type="number" min="0" step="0.01" value={editing.target} onChange={(e) => setEditing({ ...editing, target: e.target.value })} /></Field>
            {!editing.id && <Field label="Current amount"><input type="number" min="0" step="0.01" value={editing.current} onChange={(e) => setEditing({ ...editing, current: e.target.value })} /></Field>}
            <Field label="Monthly plan"><input type="number" min="0" step="0.01" value={editing.monthly} onChange={(e) => setEditing({ ...editing, monthly: e.target.value })} /></Field>
            <Field label="Target date"><input type="date" value={editing.targetDate} onChange={(e) => setEditing({ ...editing, targetDate: e.target.value })} /></Field>
            <Field label="Whose pot">
              <select value={editing.ownerId} onChange={(e) => setEditing({ ...editing, ownerId: e.target.value })}>
                {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </Field>
            <Field label="Notes" wide><textarea value={editing.notes} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} /></Field>
          </div>
        </Modal>
      )}

      {move && (
        <Modal title={`Move money · ${move.name}`} onClose={() => setMove(null)} footer={<><button className="btn-ghost" onClick={() => setMove(null)}>Cancel</button><button className="btn" disabled={busy} onClick={applyMove}>{busy ? "Working…" : "Confirm"}</button></>}>
          <div className="form-grid">
            <Field label="Amount"><input type="number" min="0" step="0.01" value={move.amount} onChange={(e) => setMove({ ...move, amount: e.target.value })} /></Field>
            <Field label="Action">
              <select value={move.kind} onChange={(e) => setMove({ ...move, kind: e.target.value })}>
                <option value="deposit">Deposit</option>
                <option value="withdraw">Withdraw</option>
              </select>
            </Field>
            <Field label="Date"><input type="date" value={move.date} onChange={(e) => setMove({ ...move, date: e.target.value })} /></Field>
            <Field label="Note"><input value={move.notes} onChange={(e) => setMove({ ...move, notes: e.target.value })} /></Field>
          </div>
        </Modal>
      )}
    </>
  );
}
