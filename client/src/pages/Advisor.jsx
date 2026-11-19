import { useEffect, useState } from "react";
import { api } from "../api.js";
import { buildAdvice } from "../advice.js";
import { money, monthLabel, shiftMonth } from "../format.js";
import { MonthNav, Notice, Progress } from "../ui.jsx";

export function Advisor({ session, month, setMonth }) {
  const [pack, setPack] = useState(null);
  const [cut, setCut] = useState(15);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const currency = session.household?.currency || "PLN";

  async function recalculate() {
    setBusy(true);
    setError("");
    try {
      const [dash, savings, projects] = await Promise.all([
        api.dashboard(month),
        session.grants.savings ? api.savings() : { items: [] },
        session.grants.projects ? api.projects() : { items: [] },
      ]);
      setPack(buildAdvice({ dash, savings: savings.items || [], projects: projects.items || [], currency }));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    recalculate();
  }, [month]);

  if (error) return <Notice error={error} />;
  if (!pack) return <p className="lede">Recalculating the household…</p>;

  const cutValue = pack.topCategory ? Math.round(pack.topCategory.amount_cents * (cut / 100)) : 0;
  const nextSurplus = pack.surplus + cutValue;

  return (
    <>
      <header className="page-head">
        <div>
          <p className="kicker">Live the income you have</p>
          <h2>Advisor</h2>
          <p className="lede">Recalculate income, spending, and savings, then follow a short list of household moves — how to keep more złoty and live inside this month’s pay.</p>
        </div>
        <div className="row">
          <MonthNav month={month} label={monthLabel(month)} onChange={(d) => setMonth(shiftMonth(month, d))} />
          <button className="btn" disabled={busy} onClick={recalculate}>{busy ? "Recalculating…" : "Recalculate"}</button>
        </div>
      </header>

      <section className="kpi-grid">
        <article className="kpi">
          <h3>Household health</h3>
          <div className="value">{pack.health}</div>
          <Progress value={pack.health} />
          <div className="hint">100 is a calm, well-buffered month</div>
        </article>
        <article className="kpi">
          <h3>Income</h3>
          <div className="value">{money(pack.income, currency)}</div>
          <div className="hint">{Math.round(pack.needsShare * 100)}% already going out</div>
        </article>
        <article className="kpi">
          <h3>Spending</h3>
          <div className="value">{money(pack.spend, currency)}</div>
          <div className="hint">Expenses plus other costs</div>
        </article>
        <article className="kpi">
          <h3>Kept this month</h3>
          <div className={`value ${pack.surplus >= 0 ? "pos" : "neg"}`}>{money(pack.surplus, currency)}</div>
          <div className="hint">{Math.round(pack.saveShare * 100)}% of income · pots hold {money(pack.savedStock, currency)}</div>
        </article>
      </section>

      <section className="split" style={{ marginTop: 14 }}>
        <article className="card">
          <h3>Live accordingly — 50 / 30 / 20</h3>
          <p className="lede">A household that lasts spends about half on needs, a third on wants, and parks a fifth.</p>
          <RuleRow label="Needs · 50%" have={pack.spend} aim={pack.targetNeeds} currency={currency} />
          <RuleRow label="Wants · 30%" have={Math.max(0, pack.spend - pack.targetNeeds)} aim={pack.targetWants} currency={currency} />
          <RuleRow label="Saved · 20%" have={Math.max(0, pack.surplus)} aim={pack.targetSave} currency={currency} />
        </article>
        <article className="card">
          <h3>What if we cut the biggest spend</h3>
          {pack.topCategory ? (
            <>
              <p className="lede">{pack.topCategory.category} is {money(pack.topCategory.amount_cents, currency)}. Slide to test a cut.</p>
              <input type="range" min="5" max="40" value={cut} onChange={(e) => setCut(Number(e.target.value))} />
              <p className="money pos" style={{ marginTop: 12 }}>{money(cutValue, currency)} kept at {cut}%</p>
              <p className="hint">Surplus would move to {money(nextSurplus, currency)}.</p>
            </>
          ) : (
            <p className="lede">Add expenses and recalculate to test a cut.</p>
          )}
        </article>
      </section>

      <section className="card" style={{ marginTop: 14 }}>
        <h3>Ideas to raise savings and live on this income</h3>
        <div className="idea-list">
          {pack.ideas.map((idea) => (
            <article key={idea.title} className={`idea idea-${idea.tone}`}>
              <h4>{idea.title}</h4>
              <p>{idea.body}</p>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}

function RuleRow({ label, have, aim, currency }) {
  const over = have > aim && aim > 0;
  return (
    <div style={{ marginTop: 14 }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <span>{label}</span>
        <strong className={over ? "neg" : "pos"}>{money(have, currency)} / {money(aim, currency)}</strong>
      </div>
      <Progress value={aim ? Math.min(100, Math.round((have / aim) * 100)) : 0} />
    </div>
  );
}
