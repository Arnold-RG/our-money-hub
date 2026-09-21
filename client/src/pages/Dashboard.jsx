import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { longDate, money, monthLabel, prettyDate, shiftMonth } from "../format.js";
import { Empty, Money, MonthNav, Notice } from "../ui.jsx";

const TYPES = [
  ["all", "All"],
  ["income", "Income"],
  ["expense", "Expenses"],
  ["cost", "Other costs"],
  ["savings", "Savings"],
  ["project", "Projects"],
];

export function Dashboard({ session, month, setMonth }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [kind, setKind] = useState("all");
  const [person, setPerson] = useState("all");
  const [query, setQuery] = useState("");
  const currency = session.household?.currency || "PLN";
  const people = (session.members || []).filter((row) => row.role !== "guest");

  useEffect(() => {
    let alive = true;
    api.dashboard(month).then((payload) => {
      if (alive) setData(payload);
    }).catch((err) => setError(err.message));
    return () => { alive = false; };
  }, [month]);

  const rows = useMemo(() => {
    const list = data?.book || [];
    const q = query.trim().toLowerCase();
    return list.filter((row) => {
      if (kind !== "all" && row.kind !== kind) return false;
      if (person !== "all" && row.owner_id !== person && row.person !== person) return false;
      if (!q) return true;
      return `${row.title} ${row.person} ${row.category} ${row.notes} ${row.type}`.toLowerCase().includes(q);
    });
  }, [data, kind, person, query]);

  if (error) return <Notice error={error} />;
  if (!data) return <p className="lede">Gathering this month’s figures…</p>;

  const first = session.user.name.split(" ")[0];

  return (
    <>
      <header className="page-head">
        <div>
          <p className="kicker">{longDate()}</p>
          <h2>Household book, {first}.</h2>
          <p className="lede">
            {session.household?.name || "This household"} — every admin and member can add their own lines, chat together, and see the same table.
          </p>
        </div>
        <MonthNav month={month} label={monthLabel(month)} onChange={(d) => setMonth(shiftMonth(month, d))} />
      </header>

      <section className="kpi-grid">
        <article className="kpi">
          <h3>Income</h3>
          <Money cents={data.totals.income} currency={currency} />
          <div className="hint">Everyone’s money in</div>
        </article>
        <article className="kpi">
          <h3>Spending</h3>
          <Money cents={data.totals.outflow} currency={currency} />
          <div className="hint">Expenses + other costs</div>
        </article>
        <article className="kpi">
          <h3>Saved</h3>
          <Money cents={data.totals.savingsTotal} currency={currency} />
          <div className="hint">{money(data.totals.savingsMonth, currency)} moved this month</div>
        </article>
        <article className="kpi">
          <h3>Surplus</h3>
          <Money cents={data.totals.surplus} currency={currency} signed />
          <div className="hint">Income minus outflows</div>
        </article>
      </section>

      <section className="card book-card">
        <div className="book-head">
          <div>
            <h3>Household ledger</h3>
            <p className="lede">One table for admin and members. Filter by person or type.</p>
          </div>
          <div className="row">
            <Link className="btn-ghost" to="/people">Household chat</Link>
            <Link className="btn" to="/income">Add a line</Link>
          </div>
        </div>
        <div className="filter-bar">
          {TYPES.map(([id, label]) => (
            <button key={id} type="button" className={kind === id ? "chip on" : "chip"} onClick={() => setKind(id)}>{label}</button>
          ))}
          <select className="chip-select" value={person} onChange={(e) => setPerson(e.target.value)}>
            <option value="all">All people</option>
            {people.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
          </select>
          <input className="chip-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search the book" />
        </div>
        {rows.length === 0 ? (
          <Empty
            title="No household lines this month"
            text="Any member can record income, expenses, savings, or a project. It will appear here for everyone."
            action={<Link className="btn" to="/expenses">Add an expense</Link>}
          />
        ) : (
          <div className="table-wrap book-wrap">
            <table className="book-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Type</th>
                  <th>Person</th>
                  <th>Title</th>
                  <th>Category</th>
                  <th className="num">Amount</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>{prettyDate(row.date)}</td>
                    <td><span className={`type-pill ${row.kind} ${row.flow}`}>{row.type}</span></td>
                    <td><span className="owner-pill">{row.person}</span></td>
                    <td>
                      <strong>{row.title}</strong>
                      {row.notes ? <div className="hint">{row.notes}</div> : null}
                    </td>
                    <td><span className="tag">{row.category}</span></td>
                    <td className={`num ${row.flow === "in" ? "pos" : "neg"}`}>
                      {row.flow === "out" ? "−" : "+"}{money(row.amount_cents, currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="hint book-count">{rows.length} line{rows.length === 1 ? "" : "s"} this month</p>
      </section>
    </>
  );
}
