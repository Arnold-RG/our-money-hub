import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { money, monthLabel, prettyTime } from "../format.js";
import { Field, Money, Notice } from "../ui.jsx";

export function People({ session, onRefresh }) {
  const [members, setMembers] = useState([]);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [picked, setPicked] = useState(session.user.id);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [busy, setBusy] = useState(false);
  const thread = useRef(null);
  const admin = session.user.role === "admin";
  const currency = session.household?.currency || "PLN";

  async function loadPeople() {
    const data = await api.people();
    setMembers(data.members);
    setPicked((current) => (data.members.some((row) => row.id === current) ? current : (data.members[0]?.id || current)));
  }

  async function loadChat({ quiet } = {}) {
    const data = await api.chat();
    setMessages(data.messages || []);
    if (!quiet) setError("");
  }

  useEffect(() => {
    loadPeople().catch((err) => setError(err.message));
    loadChat().catch((err) => setError(err.message));
    const id = setInterval(() => {
      loadChat({ quiet: true }).catch(() => {});
      loadPeople().catch(() => {});
    }, 2800);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const box = thread.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [messages.length]);

  const person = members.find((row) => row.id === picked) || members[0];

  async function send(event) {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setBusy(true);
    setError("");
    try {
      const data = await api.sendChat(text);
      setDraft("");
      setMessages(data.messages || []);
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
          <p className="kicker">{session.household?.name || "This household"}</p>
          <h2>People & chat</h2>
          <p className="lede">Everyone in the house can talk here and open any member’s money, savings, and projects.</p>
        </div>
      </header>
      <Notice error={error} ok={ok} />

      <section className="social-shell">
        <article className="chat-room">
          <div className="chat-head">
            <div>
              <h3>Household chat</h3>
              <p className="lede">Admin and members share one thread. Messages stay in the encrypted house vault.</p>
            </div>
            <span className="tag copper">{members.length} people</span>
          </div>
          <div className="chat-thread" ref={thread}>
            {messages.length === 0 ? (
              <p className="chat-empty">No messages yet. Say hello to the house.</p>
            ) : messages.map((row) => {
              const mine = row.user_id === session.user.id;
              return (
                <div key={row.id} className={`chat-line ${mine ? "mine" : ""}`}>
                  <div className="chat-meta">
                    <strong>{mine ? "You" : row.name}</strong>
                    <span>{row.role === "admin" ? "admin" : "member"} · {prettyTime(row.created_at)}</span>
                  </div>
                  <p className="chat-bubble">{row.text}</p>
                </div>
              );
            })}
          </div>
          <form className="chat-composer" onSubmit={send}>
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={800}
              placeholder="Write a message to everyone…"
              aria-label="Household message"
            />
            <button className="btn" disabled={busy || !draft.trim()}>{busy ? "Sending…" : "Send"}</button>
          </form>
        </article>

        <article className="member-feed">
          <h3>Household members</h3>
          <p className="lede">Tap a person to see their books this month.</p>
          <div className="member-pills">
            {members.map((row) => (
              <button
                key={row.id}
                type="button"
                className={row.id === person?.id ? "chip on" : "chip"}
                onClick={() => setPicked(row.id)}
              >
                {row.name.split(" ")[0]}
              </button>
            ))}
          </div>

          {person && (
            <div className="member-card">
              <div className="row" style={{ justifyContent: "space-between" }}>
                <div>
                  <h3>{person.name}</h3>
                  <p className="lede">{person.role === "admin" ? "Admin of this household" : "Member · full household"}</p>
                </div>
                <span className="tag copper">{person.role === "spouse" ? "member" : person.role}</span>
              </div>
              <p className="hint">{monthLabel(person.month)} · {person.id === session.user.id ? "your books" : "visible to the whole house"}</p>
              <div className="member-kpis">
                <div><span>Income</span><Money cents={person.income_cents} currency={currency} /></div>
                <div><span>Spending</span><Money cents={(person.expense_cents || 0) + (person.cost_cents || 0)} currency={currency} /></div>
                <div><span>Savings</span><Money cents={person.savings_cents} currency={currency} /></div>
                <div><span>Surplus</span><Money cents={person.surplus_cents} currency={currency} signed /></div>
              </div>

              <h4>Savings pots</h4>
              {(person.savings || []).length === 0 ? <p className="lede">No savings pots yet.</p> : (
                <ul className="member-list">
                  {person.savings.map((row) => (
                    <li key={row.id}>
                      <strong>{row.name}</strong>
                      <span>{money(row.current_cents, currency)}{row.target_cents ? ` of ${money(row.target_cents, currency)}` : ""}</span>
                    </li>
                  ))}
                </ul>
              )}

              <h4>Projects</h4>
              {(person.projects || []).length === 0 ? <p className="lede">No life projects yet.</p> : (
                <ul className="member-list">
                  {person.projects.map((row) => (
                    <li key={row.id}>
                      <strong>{row.name}</strong>
                      <span>{row.status} · {money(row.spent_cents, currency)}{row.budget_cents ? ` of ${money(row.budget_cents, currency)}` : ""}</span>
                    </li>
                  ))}
                </ul>
              )}

              <div className="row" style={{ marginTop: 14, flexWrap: "wrap" }}>
                <Link className="btn-ghost" to="/">Open household table</Link>
                <Link className="btn-ghost" to="/projects">Projects</Link>
                <Link className="btn-ghost" to="/savings">Savings</Link>
              </div>
              {admin && (
                <form className="row" style={{ marginTop: 10, flexWrap: "wrap" }} onSubmit={async (event) => {
                  event.preventDefault();
                  setBusy(true); setError("");
                  try {
                    const name = newName.trim();
                    await api.addPerson({ name });
                    setNewName("");
                    setOk(`${name} is in the household.`);
                    await loadPeople();
                    onRefresh?.();
                  } catch (err) {
                    setError(err.message);
                  } finally {
                    setBusy(false);
                  }
                }}>
                  <Field label="Add a member by name">
                    <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Their name" />
                  </Field>
                  <button className="btn" disabled={busy || !newName.trim()}>Add</button>
                  {person.id !== session.user.id && (
                    <button className="btn-ghost" type="button" onClick={async () => {
                      if (!window.confirm(`Remove ${person.name} from this household?`)) return;
                      await api.removePerson(person.id);
                      await loadPeople();
                      onRefresh?.();
                    }}>Remove</button>
                  )}
                </form>
              )}
            </div>
          )}
        </article>
      </section>
    </>
  );
}
