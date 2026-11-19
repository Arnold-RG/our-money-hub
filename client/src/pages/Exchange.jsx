import { useEffect, useMemo, useState } from "react";
import { CURRENCIES, currencyName } from "../catalogs.js";
import { Notice } from "../ui.jsx";

const FAVORITES = ["PLN", "EUR", "USD", "RWF", "XAF", "CDF", "GBP"];

async function loadRates(base) {
  const code = base.toLowerCase();
  try {
    const res = await fetch(`https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/${code}.min.json`);
    if (!res.ok) throw new Error("rate");
    const data = await res.json();
    return { date: data.date, rates: data[code] || {} };
  } catch {
    const res = await fetch(`https://open.er-api.com/v6/latest/${base}`);
    if (!res.ok) throw new Error("Could not load live rates.");
    const data = await res.json();
    if (data.result !== "success") throw new Error("Could not load live rates.");
    const rates = {};
    for (const [key, value] of Object.entries(data.rates || {})) rates[key.toLowerCase()] = value;
    return { date: data.time_last_update_utc, rates };
  }
}

export function Exchange({ session }) {
  const home = session.household?.currency || "PLN";
  const [base, setBase] = useState(home);
  const [target, setTarget] = useState(base === "PLN" ? "EUR" : "PLN");
  const [amount, setAmount] = useState("100");
  const [bundle, setBundle] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function refresh(nextBase = base) {
    setBusy(true);
    setError("");
    try {
      setBundle(await loadRates(nextBase));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    refresh(base);
  }, [base]);

  const converted = useMemo(() => {
    if (!bundle) return null;
    const rate = bundle.rates[target.toLowerCase()];
    if (!rate) return null;
    return Number(amount || 0) * rate;
  }, [bundle, target, amount]);

  function swap() {
    const nextBase = target;
    const nextTarget = base;
    setTarget(nextTarget);
    setBase(nextBase);
  }

  return (
    <>
      <header className="page-head">
        <div>
          <p className="kicker">Live desk</p>
          <h2>Currency exchange</h2>
          <p className="lede">Household books stay in {home}. Use this desk to read złoty against euro, dollars, Rwandan francs, Congo-Brazzaville CFA, and more.</p>
        </div>
        <button className="btn-ghost" disabled={busy} onClick={() => refresh()}>{busy ? "Updating…" : "Refresh rates"}</button>
      </header>
      <Notice error={error} />

      <section className="card exchange-hero">
        <div className="form-grid">
          <label className="field">
            <span>Amount</span>
            <input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>
          <label className="field">
            <span>From</span>
            <select value={base} onChange={(e) => setBase(e.target.value)}>
              {CURRENCIES.map((item) => <option key={item.code} value={item.code}>{item.code} — {item.name}</option>)}
            </select>
          </label>
          <label className="field">
            <span>To</span>
            <select value={target} onChange={(e) => setTarget(e.target.value)}>
              {CURRENCIES.map((item) => <option key={item.code} value={item.code}>{item.code} — {item.name}</option>)}
            </select>
          </label>
        </div>
        <div className="row" style={{ marginTop: 16 }}>
          <button className="btn-ghost" type="button" onClick={swap}>Swap currencies</button>
        </div>
        <div className="exchange-result">
          <p>{Number(amount || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} {base}</p>
          <strong>{converted == null ? "—" : converted.toLocaleString(undefined, { maximumFractionDigits: 2 })} {target}</strong>
          <span>{currencyName(target)}</span>
        </div>
        {bundle?.date ? <p className="hint">Rates updated {bundle.date}. For planning only — banks set their own spread.</p> : null}
      </section>

      <section className="card" style={{ marginTop: 14 }}>
        <h3>Quick pairs from {base}</h3>
        <div className="pair-grid">
          {FAVORITES.filter((code) => code !== base).map((code) => {
            const rate = bundle?.rates[code.toLowerCase()];
            const value = rate == null ? null : Number(amount || 0) * rate;
            return (
              <button key={code} className="pair" type="button" onClick={() => setTarget(code)}>
                <span>{code}</span>
                <strong>{value == null ? "—" : value.toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong>
                <em>{currencyName(code)}</em>
              </button>
            );
          })}
        </div>
      </section>
    </>
  );
}
