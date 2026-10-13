import { useEffect, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api.js";
import { passwordProblem } from "../authRules.js";
import { CURRENCIES, CURRENCY_CODES } from "../catalogs.js";
import { codeFromInviteText, copyText, shareInvite } from "../share.js";
import { takeAuthError } from "../supabaseClient.js";
import { Field, Notice, OmhMark } from "../ui.jsx";

export function Welcome({ boot, onDone, mode = "auth" }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const pathCode = decodeURIComponent((location.pathname.match(/^\/join\/(.+)$/) || [])[1] || "");
  const urlCode = codeFromInviteText(params.get("code") || pathCode || "");
  const [view, setView] = useState(() => initialView(mode, boot, location.pathname, urlCode));
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    confirm: "",
    current: "",
    householdName: "Our household",
    currency: "PLN",
    syncCode: urlCode || sessionStorage.getItem("omh.pendingCode") || "",
  });
  const [invite, setInvite] = useState({ code: "", url: "" });

  useEffect(() => {
    const authError = takeAuthError();
    if (authError) setError(authError.replace(/\+/g, " "));
  }, []);

  useEffect(() => {
    if (urlCode) {
      sessionStorage.setItem("omh.pendingCode", urlCode);
      setForm((prev) => ({ ...prev, syncCode: urlCode }));
    }
  }, [urlCode]);

  useEffect(() => {
    if (mode === "offline" || mode === "reset") return;
    if (!boot?.user) return;
    if (view === "login" || view === "signup" || view === "forgot") {
      const pending = sessionStorage.getItem("omh.pendingCode");
      setView(pending || location.pathname.startsWith("/join") ? "join" : boot.household ? "home" : "create");
    }
  }, [boot?.user, boot?.household, mode, location.pathname, view]);

  function set(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function finish() {
    sessionStorage.removeItem("omh.pendingCode");
    navigate("/", { replace: true });
    onDone();
  }

  async function run(task) {
    setBusy(true);
    setError("");
    setOk("");
    try {
      await task();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function submit(event, task) {
    event.preventDefault();
    return run(task);
  }

  if (mode === "offline" || view === "offline") {
    return (
      <Gate>
        <p className="kicker">Sign-in</p>
        <h1>This copy is not connected yet.</h1>
        <p className="lede">Our Money Hub keeps each account’s books private. This public page has no sign-in service attached, so nobody can open a household from here until that connection is in place.</p>
      </Gate>
    );
  }

  if (view === "invite") {
    return (
      <Gate>
        <p className="kicker">The household is open</p>
        <h1>Copy the join code.</h1>
        <p className="lede">Send it to the people who belong in this house. It is shown once. A new code from Settings replaces this one.</p>
        <label className="field">
          <span>Join link</span>
          <input readOnly value={invite.url} />
        </label>
        <label className="field">
          <span>Join code</span>
          <textarea readOnly value={invite.code} rows={3} spellCheck={false} />
        </label>
        <Notice error={error} ok={ok} />
        <div className="row">
          <button className="btn" type="button" onClick={async () => {
            try {
              const how = await shareInvite({ ...invite, name: form.householdName });
              setOk(how === "shared" ? "Invite sent." : "Link and code copied.");
            } catch (err) {
              setError(err.message);
            }
          }}>Send invite</button>
          <button className="btn-ghost" type="button" onClick={async () => { await copyText(invite.url); setOk("Join link copied."); }}>Copy link</button>
          <button className="btn-ghost" type="button" onClick={async () => { await copyText(invite.code); setOk("Join code copied."); }}>Copy code</button>
        </div>
        <button className="btn wide-btn" type="button" onClick={finish}>Enter the household</button>
      </Gate>
    );
  }

  if (view === "reset") {
    return (
      <Gate>
        <form onSubmit={(event) => submit(event, async () => {
          if (form.password !== form.confirm) throw new Error("Those passwords don’t match.");
          const problem = passwordProblem(form.password, boot?.user?.email || "");
          if (problem) throw new Error(problem);
          await api.updatePassword({ next: form.password });
          setOk("Password updated.");
          finish();
        })}>
          <p className="kicker">Account</p>
          <h1>Choose a new password.</h1>
          <p className="lede">At least 10 characters, with letters and numbers.</p>
          <Notice error={error} ok={ok} />
          <PasswordFields form={form} set={set} show={showPassword} toggle={() => setShowPassword((value) => !value)} confirm />
          <div className="row">
            <button className="btn" disabled={busy}>{busy ? "Saving…" : "Save password"}</button>
          </div>
        </form>
      </Gate>
    );
  }

  if (!boot?.user && view === "signup") {
    return (
      <Gate>
        <form onSubmit={(event) => submit(event, async () => {
          if (form.password !== form.confirm) throw new Error("Those passwords don’t match.");
          const result = await api.signUp(form);
          if (result.needsEmail) {
            setOk(`Check ${result.email} and confirm the account, then sign in.`);
            setView("login");
            return;
          }
          await onDone();
        })}>
          <p className="kicker">Create an account</p>
          <h1>Start with your own name.</h1>
          <p className="lede">The password is stored only as a hash. Your household is not visible to other accounts.</p>
          <Notice error={error} ok={ok} />
          <Field label="Your name" wide>
            <input name="name" autoComplete="name" value={form.name} onChange={(e) => set("name", e.target.value)} required />
          </Field>
          <Field label="Email" wide>
            <input name="email" type="email" autoComplete="email" value={form.email} onChange={(e) => set("email", e.target.value)} required />
          </Field>
          <PasswordFields form={form} set={set} show={showPassword} toggle={() => setShowPassword((value) => !value)} confirm />
          <div className="row">
            <button className="btn-ghost" type="button" onClick={() => setView("login")}>I already have an account</button>
            <button className="btn" disabled={busy}>{busy ? "Creating…" : "Create account"}</button>
          </div>
        </form>
      </Gate>
    );
  }

  if (!boot?.user && view === "forgot") {
    return (
      <Gate>
        <form onSubmit={(event) => submit(event, async () => {
          await api.sendReset(form.email);
          setOk("If that email has an account, a reset link is on its way.");
        })}>
          <p className="kicker">Password</p>
          <h1>Send a reset link.</h1>
          <p className="lede">Use the email on the account. The link brings you back here to choose a new password.</p>
          <Notice error={error} ok={ok} />
          <Field label="Email" wide>
            <input name="email" type="email" autoComplete="email" value={form.email} onChange={(e) => set("email", e.target.value)} required />
          </Field>
          <div className="row">
            <button className="btn-ghost" type="button" onClick={() => setView("login")}>Back</button>
            <button className="btn" disabled={busy}>{busy ? "Sending…" : "Send link"}</button>
          </div>
        </form>
      </Gate>
    );
  }

  if (!boot?.user) {
    return (
      <Gate>
        <form onSubmit={(event) => submit(event, async () => {
          await api.signIn(form);
          await onDone();
        })}>
          <p className="kicker">Sign in</p>
          <h1>Open your household.</h1>
          <p className="lede">Each person has their own account. A household is shared only with the people who join it.</p>
          <Notice error={error} ok={ok} />
          <Field label="Email" wide>
            <input name="email" type="email" autoComplete="username" value={form.email} onChange={(e) => set("email", e.target.value)} required />
          </Field>
          <PasswordFields form={form} set={set} show={showPassword} toggle={() => setShowPassword((value) => !value)} />
          <div className="row">
            <button className="btn" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
          </div>
          <div className="text-links">
            <button type="button" onClick={() => setView("signup")}>Create an account</button>
            <button type="button" onClick={() => setView("forgot")}>Forgot password</button>
          </div>
        </form>
      </Gate>
    );
  }

  if (view === "join") {
    return (
      <Gate>
        <form onSubmit={(event) => submit(event, async () => {
          await api.join({ ...form, syncCode: codeFromInviteText(form.syncCode) });
          sessionStorage.removeItem("omh.pendingCode");
          finish();
        })}>
          <p className="kicker">{boot.user.name}</p>
          <h1>Join a household.</h1>
          <p className="lede">Paste the code or link an admin sent. You will see that household’s books, and they will see yours inside it.</p>
          <Notice error={error} ok={ok} />
          <Field label="Join code or link" wide>
            <textarea rows={3} spellCheck={false} value={form.syncCode} onChange={(e) => set("syncCode", e.target.value)} required />
          </Field>
          <div className="row">
            <button className="btn-ghost" type="button" onClick={() => setView("create")}>Create one instead</button>
            <button className="btn" disabled={busy}>{busy ? "Joining…" : "Join household"}</button>
          </div>
        </form>
      </Gate>
    );
  }

  return (
    <Gate>
      <form onSubmit={(event) => submit(event, async () => {
        const result = await api.setup(form);
        setInvite({ code: result.syncCode, url: result.joinUrl });
        setView("invite");
      })}>
        <p className="kicker">{boot.user.name}</p>
        <h1>Name the household.</h1>
        <p className="lede">You become its admin. After this, you’ll get a join code for everyone else.</p>
        <Notice error={error} ok={ok} />
        <Field label="Household name" wide>
          <input name="organization" autoComplete="organization" value={form.householdName} onChange={(e) => set("householdName", e.target.value)} required />
        </Field>
        <Field label="Main currency" wide>
          <select value={form.currency} onChange={(e) => set("currency", e.target.value)}>
            {(boot?.currencies || CURRENCY_CODES).map((code) => {
              const name = CURRENCIES.find((item) => item.code === code)?.name;
              return <option key={code} value={code}>{code}{name ? ` — ${name}` : ""}</option>;
            })}
          </select>
        </Field>
        <div className="row">
          <button className="btn-ghost" type="button" onClick={() => setView("join")}>I have a join code</button>
          <button className="btn" disabled={busy}>{busy ? "Creating…" : "Create household"}</button>
        </div>
        {(boot.houses || []).length > 0 && (
          <div className="home-actions">
            <p className="hint">Or open one already on this account.</p>
            {boot.houses.map((house) => (
              <button key={house.id} className="btn-ghost" type="button" disabled={busy} onClick={() => run(async () => {
                await api.switchHouse(house.id);
                finish();
              })}>Open {house.name}</button>
            ))}
          </div>
        )}
      </form>
    </Gate>
  );
}

function initialView(mode, boot, pathname, urlCode) {
  if (mode === "offline" || boot?.configured === false) return "offline";
  if (mode === "reset") return "reset";
  if (!boot?.user) return "login";
  if (pathname.startsWith("/join") || urlCode || sessionStorage.getItem("omh.pendingCode")) return "join";
  if (pathname.startsWith("/create") || !boot.household) return "create";
  return "create";
}

function PasswordFields({ form, set, show, toggle, confirm = false }) {
  return (
    <>
      <Field label="Password" wide>
        <span className="secret">
          <input
            name="password"
            type={show ? "text" : "password"}
            autoComplete={confirm ? "new-password" : "current-password"}
            value={form.password}
            onChange={(e) => set("password", e.target.value)}
            required
            minLength={10}
            maxLength={72}
          />
          <button type="button" onClick={toggle}>{show ? "Hide" : "Show"}</button>
        </span>
      </Field>
      {confirm && (
        <Field label="Confirm password" wide>
          <input
            name="confirm"
            type={show ? "text" : "password"}
            autoComplete="new-password"
            value={form.confirm}
            onChange={(e) => set("confirm", e.target.value)}
            required
            minLength={10}
            maxLength={72}
          />
        </Field>
      )}
    </>
  );
}

function Gate({ children }) {
  return (
    <div className="start-wrap">
      <div className="gate">
        <aside className="gate-cover">
          <div className="brand-mark"><OmhMark /></div>
          <p className="cover-mark">Our Money Hub</p>
          <p className="cover-lead">A private ledger for one household at a time.</p>
          <ul className="cover-points">
            <li>Sign in with your own account.</li>
            <li>Books stay inside the household.</li>
            <li>An admin sends the join code.</li>
          </ul>
        </aside>
        <div className="gate-body">{children}</div>
      </div>
    </div>
  );
}
