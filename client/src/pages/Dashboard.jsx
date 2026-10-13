import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { longDate, money, monthLabel, pct, prettyDate, prettyTime, shiftMonth } from "../format.js";
import { Empty, Money, MonthNav, Notice, useNarrow } from "../ui.jsx";

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
  const narrow = useNarrow(760);
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
  const peak = Math.max(1, ...data.trend.flatMap((col) => [col.income, col.out]));
  const showTrend = data.trend.some((col) => col.income || col.out);
  const peopleWithFigures = (data.ownerBreakdown || []).filter((row) => row.income_cents || row.expense_cents || row.cost_cents || row.savings_cents);

  return (
    <>
      <header className="page-head">
        <div>
          <p className="kicker">{longDate()}</p>
          <h1>Household book, <em>{first}</em>.</h1>
          <p className="lede">{session.household?.name || "This household"} — one table for everyone who has joined.</p>
        </div>
        <MonthNav month={month} label={monthLabel(month)} onChange={(delta) => setMonth(shiftMonth(month, delta))} />
      </header>

      <section className="figure-strip" aria-label="This month">
        <article>
          <h2>Income</h2>
          <Money cents={data.totals.income} currency={currency} />
          <p>Money in</p>
        </article>
        <article>
          <h2>Spending</h2>
          <Money cents={data.totals.outflow} currency={currency} />
          <p>Expenses and other costs</p>
        </article>
        <article>
          <h2>Saved</h2>
          <Money cents={data.totals.savingsTotal} currency={currency} />
          <p>{money(data.totals.savingsMonth, currency)} moved this month</p>
        </article>
        <article>
          <h2>Left over</h2>
          <Money cents={data.totals.surplus} currency={currency} signed />
          <p>Income minus outflows</p>
        </article>
      </section>

      {(showTrend || data.categories.length > 0) && (
        <section className="split section">
          {showTrend && (
            <article className="card">
              <h2>Six months</h2>
              <p className="trend-key"><i className="swatch in" /> Income <i className="swatch out" /> Spending</p>
              <div className="trend" aria-hidden="true">
                {data.trend.map((col) => (
                  <div className="trend-col" key={col.month}>
                    <div className="trend-bars">
                      <b style={{ height: `${Math.max(4, (col.income / peak) * 100)}%` }} />
                      <i style={{ height: `${Math.max(4, (col.out / peak) * 100)}%` }} />
                    </div>
                    <small>{monthLabel(col.month).split(" ")[0].slice(0, 3)}</small>
                  </div>
                ))}
              </div>
              <ul className="sr-only">
                {data.trend.map((col) => (
                  <li key={col.month}>{monthLabel(col.month)}: income {money(col.income, currency)}, spending {money(col.out, currency)}</li>
                ))}
              </ul>
            </article>
          )}
          {data.categories.length > 0 && (
            <article className="card">
              <h2>Spending by category</h2>
              <div className="bars">
                {data.categories.slice(0, 6).map((cat) => (
                  <div className="bar-row" key={cat.category}>
                    <span>{cat.category}</span>
                    <div className="bar-track" aria-hidden="true">
                      <i style={{ width: `${pct(cat.amount_cents, data.categories[0].amount_cents)}%` }} />
                    </div>
                    <strong>{money(cat.amount_cents, currency)}</strong>
                  </div>
                ))}
              </div>
            </article>
          )}
        </section>
      )}

      {peopleWithFigures.length > 0 && (
        <section className="card section">
          <h2>By person</h2>
          <div className="table-wrap">
            <table>
              <caption className="sr-only">Household figures by person for {monthLabel(month)}</caption>
              <thead>
                <tr>
                  <th scope="col">Person</th>
                  <th scope="col" className="num">In</th>
                  <th scope="col" className="num">Out</th>
                  <th scope="col" className="num">Saved</th>
                </tr>
              </thead>
              <tbody>
                {peopleWithFigures.map((row) => (
                  <tr key={row.id}>
                    <td>{row.name}</td>
                    <td className="num pos">{money(row.income_cents, currency)}</td>
                    <td className="num neg">{money((row.expense_cents || 0) + (row.cost_cents || 0), currency)}</td>
                    <td className="num">{money(row.savings_cents, currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="card book-card">
        <div className="book-head">
          <div>
            <h2>Household ledger</h2>
            <p className="lede">Filter by person or by the kind of line.</p>
          </div>
          <div className="row">
            <Link className="btn-ghost" to="/people">Household chat</Link>
            <Link className="btn" to="/income">Add a line</Link>
          </div>
        </div>
        <div className="filter-bar">
          {TYPES.map(([id, label]) => (
            <button key={id} type="button" className={kind === id ? "filter on" : "filter"} aria-pressed={kind === id} onClick={() => setKind(id)}>{label}</button>
          ))}
          <select className="chip-select" aria-label="Filter by person" value={person} onChange={(e) => setPerson(e.target.value)}>
            <option value="all">All people</option>
            {people.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
          </select>
          <input className="chip-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search the book" aria-label="Search the book" />
        </div>
        {rows.length === 0 ? (
          <Empty
            title="No lines this month"
            text="Any member can record income, an expense, savings, or a project. It shows up here for the household."
            action={<Link className="btn" to="/expenses">Add an expense</Link>}
          />
        ) : narrow ? (
          <ol className="slips">
            {rows.map((row) => (
              <li key={row.id} className="slip">
                <div className="slip-top">
                  <span className={`type-pill ${row.kind}`}>{row.type}</span>
                  <strong className={row.flow === "in" ? "pos" : "neg"}>{row.flow === "out" ? "−" : "+"}{money(row.amount_cents, currency)}</strong>
                </div>
                <p className="slip-title">{row.title}</p>
                <p className="hint">{prettyDate(row.date)} · {row.person} · {row.category}</p>
                {row.notes ? <p className="hint">{row.notes}</p> : null}
              </li>
            ))}
          </ol>
        ) : (
          <div className="table-wrap book-wrap">
            <table className="book-table">
              <caption className="sr-only">Household lines for {monthLabel(month)}</caption>
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Type</th>
                  <th scope="col">Person</th>
                  <th scope="col">Title</th>
                  <th scope="col">Category</th>
                  <th scope="col" className="num">Amount</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>{prettyDate(row.date)}</td>
                    <td><span className={`type-pill ${row.kind}`}>{row.type}</span></td>
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

      {(data.savings.length > 0 || data.projects.length > 0) && (
        <section className="split section">
          {data.savings.length > 0 && (
            <article className="card">
              <h2>Savings still open</h2>
              <div className="list">
                {data.savings.slice(0, 4).map((row) => (
                  <div className="list-item" key={row.id}>
                    <span>{row.name}<br /><span className="hint">{row.owner_name}</span></span>
                    <strong>{money(row.current_cents, currency)}</strong>
                  </div>
                ))}
              </div>
            </article>
          )}
          {data.projects.length > 0 && (
            <article className="card">
              <h2>Projects in motion</h2>
              <div className="list">
                {data.projects.map((row) => (
                  <div className="list-item" key={row.id}>
                    <span>{row.name}<br /><span className="hint">{row.status}</span></span>
                    <strong>{money(row.spent_cents, currency)}</strong>
                  </div>
                ))}
              </div>
            </article>
          )}
        </section>
      )}

      {data.recent.length > 0 && (
        <section className="card section">
          <h2>Recent changes</h2>
          <div className="list">
            {data.recent.map((row) => (
              <div className="list-item" key={row.id}>
                <span><strong>{row.actor_name}</strong> {row.detail}</span>
                <span className="hint">{prettyTime(row.created_at)}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
