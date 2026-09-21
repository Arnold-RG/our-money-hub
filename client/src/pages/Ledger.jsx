import { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import { money, monthLabel, prettyDate, shiftMonth, today } from "../format.js";
import { Empty, Field, Modal, MonthNav, Notice } from "../ui.jsx";

const KINDS = {
  income: {
    path: "income",
    kicker: "Money in",
    title: "Income",
    lede: "Salaries, business, gifts, and anything else that lands in the household.",
    add: "Record income",
    titleField: "source",
    titleLabel: "Source",
  },
  expenses: {
    path: "expenses",
    kicker: "Day to day",
    title: "Expenses",
    lede: "Food, transport, bills, and the ordinary life of the house.",
    add: "Add expense",
    titleField: "merchant",
    titleLabel: "Paid to",
  },
  costs: {
    path: "costs",
    kicker: "Other costs",
    title: "Other costs",
    lede: "Insurance, fees, subscriptions, and anything that does not sit neatly as a daily expense.",
    add: "Add a cost",
    titleField: "title",
    titleLabel: "Title",
  },
};

export function Ledger({ kind, session, month, setMonth }) {
  const meta = KINDS[kind];
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const currency = session.household?.currency || "PLN";
  const members = session.members.filter((m) => m.role !== "guest");

  async function load() {
    const payload = await api.ledger(meta.path, month);
    setData(payload);
  }

  useEffect(() => {
    setError("");
    load().catch((err) => setError(err.message));
  }, [kind, month]);

  const grouped = useMemo(() => {
    if (!data) return [];
    const map = new Map();
    for (const row of data.items) {
      map.set(row.category, (map.get(row.category) || 0) + row.amount_cents);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [data]);

  async function save(form) {
    setBusy(true);
    setError("");
    try {
      const body = {
        [meta.titleField]: form.title,
        title: form.title,
        category: form.category,
        amount: Number(form.amount),
        date: form.date,
        recurring: form.recurring,
        notes: form.notes,
        ownerId: form.ownerId || session.user.id,
      };
      if (form.id) await api.updateLedger(meta.path, form.id, body);
      else await api.addLedger(meta.path, body);
      setEditing(null);
      setOk(form.id ? "Updated." : "Saved to the household ledger.");
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id) {
    if (!window.confirm("Remove this entry from the household ledger?")) return;
    await api.deleteLedger(meta.path, id);
    await load();
  }

  if (!data && !error) return <p className="lede">Opening the {meta.title.toLowerCase()} book…</p>;

  return (
    <>
      <header className="page-head">
        <div>
          <p className="kicker">{meta.kicker}</p>
          <h2>{meta.title}</h2>
          <p className="lede">{meta.lede} Everyone in the household can add a line and see every other person’s lines.</p>
        </div>
        <div className="row">
          <MonthNav month={month} label={monthLabel(month)} onChange={(d) => setMonth(shiftMonth(month, d))} />
          <button className="btn" onClick={() => setEditing({
            title: "",
            category: data?.categories[0] || "Other",
            amount: "",
            date: today(),
            recurring: "none",
            notes: "",
            ownerId: session.user.id,
          })}>{meta.add}</button>
        </div>
      </header>
      <Notice error={error} ok={ok} />
      <section className="kpi-grid" style={{ gridTemplateColumns: "repeat(2, minmax(0,1fr))" }}>
        <article className="kpi">
          <h3>This month</h3>
          <div className="value">{money(data?.totalCents, currency)}</div>
          <div className="hint">{data?.items.length || 0} entries</div>
        </article>
        <article className="kpi">
          <h3>Largest category</h3>
          <div className="value">{grouped[0]?.[0] || "—"}</div>
          <div className="hint">{grouped[0] ? money(grouped[0][1], currency) : "Nothing recorded yet"}</div>
        </article>
      </section>
      <section className="card" style={{ marginTop: 14 }}>
        {!data?.items.length ? (
          <Empty title={`No ${meta.title.toLowerCase()} this month`} text="Write it down once and the whole household will see it in Home." action={<button className="btn" onClick={() => setEditing({ title: "", category: data.categories[0], amount: "", date: today(), recurring: "none", notes: "", ownerId: session.user.id })}>{meta.add}</button>} />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>{meta.titleLabel}</th>
                  <th>Category</th>
                  <th>Whose account</th>
                  <th>Rhythm</th>
                  <th className="num">Amount</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((row) => (
                  <tr key={row.id}>
                    <td>{prettyDate(row.received_on || row.spent_on || row.due_on)}</td>
                    <td>
                      <strong>{row.source || row.merchant || row.title}</strong>
                      {row.notes ? <div style={{ color: "var(--muted)", fontSize: "0.85rem" }}>{row.notes}</div> : null}
                    </td>
                    <td><span className="tag">{row.category}</span></td>
                    <td><span className="owner-pill">{row.owner_name}</span></td>
                    <td>{row.recurring === "none" ? "Once" : row.recurring}</td>
                    <td className="num">{money(row.amount_cents, currency)}</td>
                    <td>
                      <div className="row">
                        <button className="btn-ghost btn-small" onClick={() => setEditing({
                          id: row.id,
                          title: row.source || row.merchant || row.title,
                          category: row.category,
                          amount: (row.amount_cents / 100).toString(),
                          date: row.received_on || row.spent_on || row.due_on,
                          recurring: row.recurring,
                          notes: row.notes || "",
                          ownerId: row.owner_id,
                        })}>Edit</button>
                        <button className="btn-ghost btn-small" onClick={() => remove(row.id)}>Remove</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {editing && (
        <Modal
          title={editing.id ? `Edit ${meta.title.toLowerCase()}` : meta.add}
          onClose={() => setEditing(null)}
          footer={(
            <>
              <button className="btn-ghost" type="button" onClick={() => setEditing(null)}>Cancel</button>
              <button className="btn" disabled={busy} onClick={() => save(editing)}>{busy ? "Saving…" : "Save"}</button>
            </>
          )}
        >
          <div className="form-grid">
            <Field label={meta.titleLabel} wide>
              <input value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} />
            </Field>
            <Field label="Amount">
              <input type="number" min="0" step="0.01" value={editing.amount} onChange={(e) => setEditing({ ...editing, amount: e.target.value })} />
            </Field>
            <Field label="Date">
              <input type="date" value={editing.date} onChange={(e) => setEditing({ ...editing, date: e.target.value })} />
            </Field>
            <Field label="Category">
              <select value={editing.category} onChange={(e) => setEditing({ ...editing, category: e.target.value })}>
                {(data?.categories || []).map((c) => <option key={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Whose account">
              <select value={editing.ownerId} onChange={(e) => setEditing({ ...editing, ownerId: e.target.value })}>
                {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </Field>
            <Field label="Repeats">
              <select value={editing.recurring} onChange={(e) => setEditing({ ...editing, recurring: e.target.value })}>
                <option value="none">Once</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="yearly">Yearly</option>
              </select>
            </Field>
            <Field label="Notes" wide>
              <textarea value={editing.notes} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} />
            </Field>
          </div>
        </Modal>
      )}
    </>
  );
}
