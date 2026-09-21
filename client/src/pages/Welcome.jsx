import { useEffect, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api.js";
import { CURRENCY_CODES } from "../catalogs.js";
import { codeFromInviteText, copyText, joinUrl, shareInvite } from "../share.js";
import { Field, Notice, OmhMark } from "../ui.jsx";

export function Welcome({ boot, onDone }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const pathCode = decodeURIComponent((location.pathname.match(/^\/join\/(.+)$/) || [])[1] || "");
  const urlCode = params.get("code") || pathCode || "";
  const start = location.pathname.startsWith("/join") || urlCode ? "join" : location.pathname.startsWith("/create") ? "create" : "home";
  const [view, setView] = useState(start);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    name: "",
    householdName: "Our household",
    currency: "PLN",
    syncCode: urlCode,
  });
  const [invite, setInvite] = useState({ code: "", url: "" });
  const houses = boot?.houses || [];

  useEffect(() => {
    if (urlCode) setForm((prev) => ({ ...prev, syncCode: urlCode }));
  }, [urlCode]);

  function set(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function finish() {
    navigate("/", { replace: true });
    onDone();
  }

  async function afterOpen(result) {
    if (result.syncCode) {
      setInvite({ code: result.syncCode, url: result.joinUrl || joinUrl(result.syncCode) });
      setView("invite");
      return;
    }
    finish();
  }

  async function create(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await afterOpen(await api.setup(form));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function join(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await afterOpen(await api.join(form));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (view === "home") {
    return (
      <div className="auth-wrap">
        <div className="auth-card">
          <Brand />
          <h2>Open your household.</h2>
          <p className="lede">No login. Create a house, or join with the code or link an admin sends. Add your name so the books know who is who.</p>
          <Notice error={error} ok={ok} />
          {houses.length > 0 && (
            <div className="home-actions" style={{ marginBottom: 12 }}>
              {houses.map((house) => (
                <button key={house.id} className="btn" type="button" disabled={busy} onClick={async () => {
                  setBusy(true); setError("");
                  try {
                    await api.switchHouse(house.id);
                    finish();
                  } catch (err) {
                    setError(err.message);
                  } finally {
                    setBusy(false);
                  }
                }}>Open {house.name}</button>
              ))}
            </div>
          )}
          <div className="home-actions">
            <button className="btn" onClick={() => setView("create")}>Create a household</button>
            <button className="btn-ghost" onClick={() => setView("join")}>Join with a code or link</button>
          </div>
        </div>
      </div>
    );
  }

  if (view === "invite") {
    return (
      <div className="auth-wrap">
        <div className="auth-card">
          <Brand />
          <h2>Share this house</h2>
          <p className="lede">Send the link or code. People only add their name to join — no password, email, or codes to type.</p>
          <p className="hint">{invite.url}</p>
          <textarea readOnly value={invite.code} rows={3} />
          <Notice error={error} ok={ok} />
          <div className="row" style={{ marginTop: 12 }}>
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
          <button className="btn" style={{ marginTop: 14, width: "100%" }} type="button" onClick={finish}>Enter the household</button>
        </div>
      </div>
    );
  }

  const creating = view === "create";
  return (
    <div className="auth-wrap">
      <form className="auth-card" onSubmit={creating ? create : join}>
        <Brand />
        <h2>{creating ? "Create your household" : "Join a household"}</h2>
        <p className="lede">
          {creating
            ? "You become the admin. After this, the app generates a join code and link for everyone else."
            : "Paste the admin’s code or open their invite link, then add the name you use in this house."}
        </p>
        <Notice error={error} ok={ok} />
        <div className="form-grid" style={{ marginTop: 16 }}>
          {!creating && (
            <Field label="Household join code or link" wide>
              <input name="invite" value={form.syncCode} onChange={(e) => set("syncCode", codeFromInviteText(e.target.value))} required placeholder="Paste the special code or invite link" />
            </Field>
          )}
          <Field label="Your name" wide>
            <input name="name" autoComplete="name" value={form.name} onChange={(e) => set("name", e.target.value)} required />
          </Field>
          {creating && (
            <>
              <Field label="Household name">
                <input name="organization" autoComplete="organization" value={form.householdName} onChange={(e) => set("householdName", e.target.value)} required />
              </Field>
              <Field label="Main currency">
                <select value={form.currency} onChange={(e) => set("currency", e.target.value)}>
                  {(boot?.currencies || CURRENCY_CODES).map((code) => <option key={code}>{code}</option>)}
                </select>
              </Field>
            </>
          )}
        </div>
        <div className="row" style={{ marginTop: 16 }}>
          <button className="btn-ghost" type="button" onClick={() => setView("home")}>Back</button>
          <button className="btn" disabled={busy}>
            {busy ? "Working…" : creating ? "Create household" : "Join household"}
          </button>
        </div>
      </form>
    </div>
  );
}

function Brand() {
  return (
    <div className="brand" style={{ marginBottom: 8 }}>
      <div className="brand-mark"><OmhMark live /></div>
      <div>
        <h1>Our Money Hub</h1>
        <p>OMH · household books</p>
      </div>
    </div>
  );
}
