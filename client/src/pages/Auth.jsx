import { useState } from "react";
import { api } from "../api.js";
import { Field, Notice, OmhMark } from "../ui.jsx";

export function Auth({ mode, currencies, onDone }) {
  if (mode === "setup") return <Setup currencies={currencies} onDone={onDone} />;
  return <Login onDone={onDone} />;
}

function Login({ onDone }) {
  const [tab, setTab] = useState("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [syncCode, setSyncCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (tab === "join") await api.join({ syncCode, email, password });
      else await api.login({ email, password });
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <form className="auth-card" onSubmit={submit}>
        <BrandBlock />
        <h2>Welcome back to Our Money Hub.</h2>
        <p className="lede">Only household accounts can enter. There is no public signup. After five failed tries the door locks for fifteen minutes.</p>
        <div className="tab-row">
          <button type="button" className={tab === "in" ? "btn" : "btn-ghost"} onClick={() => setTab("in")}>Sign in</button>
          <button type="button" className={tab === "join" ? "btn" : "btn-ghost"} onClick={() => setTab("join")}>Join household</button>
        </div>
        <Notice error={error} />
        <div className="form-grid" style={{ marginTop: 18 }}>
          {tab === "join" && (
            <Field label="Household join code" wide>
              <input value={syncCode} onChange={(e) => setSyncCode(e.target.value)} autoComplete="off" placeholder="OMH-1...." required />
            </Field>
          )}
          <Field label="Email" wide>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required />
          </Field>
          <Field label="Password" wide>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
          </Field>
        </div>
        <div className="row" style={{ marginTop: 18 }}>
          <button className="btn" disabled={busy}>{busy ? "Opening…" : tab === "join" ? "Join and enter" : "Enter OMH"}</button>
        </div>
      </form>
    </div>
  );
}

function Setup({ currencies, onDone }) {
  const [step, setStep] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [syncCode, setSyncCode] = useState("");
  const [form, setForm] = useState({
    adminName: "",
    adminEmail: "",
    adminPassword: "",
    householdName: "Our household",
    currency: "PLN",
    spouseName: "",
    spouseEmail: "",
    spousePassword: "",
  });

  function set(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function submit(event) {
    event.preventDefault();
    if (step < 2) {
      setStep(step + 1);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await api.setup(form);
      setSyncCode(result.syncCode || "");
      setStep(3);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <form className="auth-card" onSubmit={step === 3 ? (event) => { event.preventDefault(); onDone(); } : submit}>
        <BrandBlock />
        <h2>Open Our Money Hub for the two of you.</h2>
        <p className="lede">Your account is admin. Your partner sees every złoty with no extra permission. Outsiders stay out unless you invite them.</p>
        <div className="steps">{[0, 1, 2, 3].map((n) => <i key={n} className={n <= step ? "on" : ""} />)}</div>
        <Notice error={error} />
        {step === 0 && (
          <div className="form-grid">
            <Field label="Your name" wide>
              <input value={form.adminName} onChange={(e) => set("adminName", e.target.value)} required />
            </Field>
            <Field label="Your email">
              <input type="email" value={form.adminEmail} onChange={(e) => set("adminEmail", e.target.value)} required />
            </Field>
            <Field label="Password (10+ characters, letters and numbers)">
              <input type="password" value={form.adminPassword} onChange={(e) => set("adminPassword", e.target.value)} minLength={10} required />
            </Field>
          </div>
        )}
        {step === 1 && (
          <div className="form-grid">
            <Field label="Household name">
              <input value={form.householdName} onChange={(e) => set("householdName", e.target.value)} required />
            </Field>
            <Field label="Main currency">
              <select value={form.currency} onChange={(e) => set("currency", e.target.value)}>
                {currencies.map((code) => <option key={code}>{code}</option>)}
              </select>
            </Field>
          </div>
        )}
        {step === 2 && (
          <div className="form-grid">
            <Field label="Partner name" wide>
              <input value={form.spouseName} onChange={(e) => set("spouseName", e.target.value)} placeholder="Optional now — you can add later" />
            </Field>
            <Field label="Partner email">
              <input type="email" value={form.spouseEmail} onChange={(e) => set("spouseEmail", e.target.value)} />
            </Field>
            <Field label="Partner password">
              <input type="password" value={form.spousePassword} onChange={(e) => set("spousePassword", e.target.value)} />
            </Field>
          </div>
        )}
        {step === 3 && (
          <div className="join-box">
            <p>Give this join code only to your partner. It unlocks the household books on their phone. Do not post it in public.</p>
            <textarea readOnly value={syncCode} rows={4} />
            <button className="btn-ghost" type="button" onClick={() => navigator.clipboard.writeText(syncCode)}>Copy join code</button>
          </div>
        )}
        <div className="row" style={{ marginTop: 18 }}>
          {step > 0 && step < 3 && <button className="btn-ghost" type="button" onClick={() => setStep(step - 1)}>Back</button>}
          <button className="btn" disabled={busy}>
            {step < 2 ? "Continue" : step === 2 ? (busy ? "Opening OMH…" : "Create household") : "Enter Our Money Hub"}
          </button>
        </div>
      </form>
    </div>
  );
}

function BrandBlock() {
  return (
    <div className="brand" style={{ marginBottom: 8 }}>
      <div className="brand-mark"><OmhMark /></div>
      <div>
        <h1>Our Money Hub</h1>
        <p>OMH · household books</p>
      </div>
    </div>
  );
}
