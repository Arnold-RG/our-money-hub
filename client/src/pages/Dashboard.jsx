import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { longDate, money, monthLabel, pct, prettyDate, shiftMonth } from "../format.js";
import { Empty, Money, MonthNav, Notice, Progress } from "../ui.jsx";

export function Dashboard({ session, month, setMonth }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const currency = session.household?.currency || "PLN";

  useEffect(() => {
    let alive = true;
    api.dashboard(month).then((payload) => {
      if (alive) setData(payload);
    }).catch((err) => setError(err.message));
    return () => { alive = false; };
  }, [month]);

  if (error) return <Notice error={error} />;
  if (!data) return <p className="lede">Gathering this month’s figures…</p>;
  if (data.locked) {
    return (
      <header className="page-head">
        <div>
          <p className="kicker">{longDate()}</p>
          <h2>Waiting for access</h2>
          <p className="lede">The household books are closed to this account until the admin opens a door in People.</p>
        </div>
      </header>
    );
  }

  const first = session.user.name.split(" ")[0];
  const maxTrend = Math.max(1, ...data.trend.flatMap((row) => [row.income, row.out]));

  return (
    <>
      <header className="page-head">
        <div>
          <p className="kicker">{longDate()}</p>
          <h2>Good to see you, {first}.</h2>
          <p className="lede">A shared view of {session.household?.name || "the household"} — both of you can read and write every figure.</p>
        </div>
        <MonthNav month={month} label={monthLabel(month)} onChange={(d) => setMonth(shiftMonth(month, d))} />
      </header>

      <section className="kpi-grid">
        <article className="kpi">
          <h3>Income</h3>
          <Money cents={data.totals.income} currency={currency} />
          <div className="hint">What came in this month</div>
        </article>
        <article className="kpi">
          <h3>Spending</h3>
          <Money cents={data.totals.outflow} currency={currency} />
          <div className="hint">Expenses + other costs</div>
        </article>
        <article className="kpi">
          <h3>Saved so far</h3>
          <Money cents={data.totals.savingsTotal} currency={currency} />
          <div className="hint">{money(data.totals.savingsMonth, currency)} moved this month</div>
        </article>
        <article className="kpi">
          <h3>Surplus</h3>
          <Money cents={data.totals.surplus} currency={currency} signed />
          <div className="hint">Income minus all outflows</div>
        </article>
      </section>

      <section className="split" style={{ marginTop: 14 }}>
        <article className="card">
          <h3>Six-month pulse</h3>
          <div className="trend" style={{ marginTop: 16 }}>
            {data.trend.map((row) => (
              <div className="trend-col" key={row.month}>
                <div className="trend-bars">
                  <b style={{ height: `${(row.income / maxTrend) * 100}%` }} title="Income" />
                  <i style={{ height: `${(row.out / maxTrend) * 100}%` }} title="Outflow" />
                </div>
                <small>{row.month.slice(5)}</small>
              </div>
            ))}
          </div>
          <p className="hint" style={{ color: "var(--muted)", marginTop: 12 }}>Sage is income. Copper is money going out.</p>
        </article>
        <article className="card">
          <h3>Where spending went</h3>
          {data.categories.length === 0 ? (
            <Empty title="No expenses yet" text="Write the first one and the household picture will appear." action={<Link className="btn" to="/expenses">Add an expense</Link>} />
          ) : (
            <div className="bars" style={{ marginTop: 14 }}>
              {data.categories.map((row) => (
                <div className="bar-row" key={row.category}>
                  <span>{row.category}</span>
                  <div className="bar-track"><i style={{ width: `${pct(row.amount_cents, data.totals.expenses)}%` }} /></div>
                  <strong className="num">{money(row.amount_cents, currency)}</strong>
                </div>
              ))}
            </div>
          )}
        </article>
      </section>

      {data.ownerBreakdown.length > 0 && (
        <section className="card" style={{ marginTop: 14 }}>
          <h3>Both accounts, one picture</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Person</th>
                  <th className="num">Income</th>
                  <th className="num">Expenses</th>
                  <th className="num">Other costs</th>
                  <th className="num">Savings</th>
                </tr>
              </thead>
              <tbody>
                {data.ownerBreakdown.map((row) => (
                  <tr key={row.id}>
                    <td>{row.name}</td>
                    <td className="num">{money(row.income_cents, currency)}</td>
                    <td className="num">{money(row.expense_cents, currency)}</td>
                    <td className="num">{money(row.cost_cents, currency)}</td>
                    <td className="num">{money(row.savings_cents, currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="card-grid" style={{ marginTop: 14 }}>
        <article className="card">
          <h3>Savings pots</h3>
          {data.savings.length === 0 ? <p className="lede">No pots yet.</p> : data.savings.map((row) => (
            <div key={row.id} style={{ marginTop: 14 }}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <strong>{row.name}</strong>
                <span>{money(row.current_cents, currency)}</span>
              </div>
              <Progress value={pct(row.current_cents, row.target_cents || 1)} />
            </div>
          ))}
        </article>
        <article className="card">
          <h3>Life projects</h3>
          {data.projects.length === 0 ? <p className="lede">No open projects.</p> : data.projects.map((row) => (
            <div key={row.id} style={{ marginTop: 14 }}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <strong>{row.name}</strong>
                <span className="tag">{row.status}</span>
              </div>
              <Progress value={pct(row.spent_cents, row.budget_cents || 1)} />
              <p className="hint" style={{ color: "var(--muted)" }}>{money(row.spent_cents, currency)} of {money(row.budget_cents, currency)}{row.target_date ? ` · ${prettyDate(row.target_date)}` : ""}</p>
            </div>
          ))}
        </article>
      </section>

      <section className="card" style={{ marginTop: 14 }}>
        <h3>Latest household activity</h3>
        <div className="list">
          {data.recent.map((row) => (
            <div className="list-item" key={row.id}>
              <div>
                <strong>{row.detail}</strong>
                <div className="hint" style={{ color: "var(--muted)" }}>{row.actor_name}</div>
              </div>
              <span>{prettyDate(row.created_at)}</span>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
