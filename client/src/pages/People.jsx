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

  async function loadChat() {
    const data = await api.chat();
    setMessages(data.messages || []);
  }

  useEffect(() => {
    let alive = true;
    async function tick(quiet) {
      if (document.hidden) return;
      try {
        await loadPeople();
        await loadChat();
        if (!quiet && alive) setError("");
      } catch (err) {
        if (!quiet && alive) setError(err.message);
      }
    }
    tick(false);
    const id = setInterval(() => tick(true), 8000);
    function onVisible() {
      if (!document.hidden) tick(true);
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
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

  async function changeRole(member, role) {
    setBusy(true);
    setError("");
    setOk("");
    try {
      await api.setRole(member.id, role);
      setOk(role === "admin" ? `${member.name} is now an admin.` : `${member.name} is now a member.`);
      await loadPeople();
      onRefresh?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function drop(member) {
    if (!window.confirm(`Remove ${member.name} from this household? Their lines stay in the books.`)) return;
    setBusy(true);
    setError("");
    setOk("");
    try {
      await api.removePerson(member.id);
      setOk(`${member.name} is no longer in this household.`);
      await loadPeople();
      onRefresh?.();
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
          <h1>People and chat</h1>
          <p className="lede">Everyone who joined this house can talk here and open any member’s money, savings, and projects.</p>
        </div>
      </header>
      <Notice error={error} ok={ok} />

      <section className="social-shell">
        <article className="chat-room">
          <div className="chat-head">
            <div>
              <h2>Household chat</h2>
              <p className="lede">One thread for this house. Only its members can read it.</p>
            </div>
            <span className="tag">{members.length} {members.length === 1 ? "person" : "people"}</span>
          </div>
          <div className="chat-thread" ref={thread} aria-live="polite">
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
            <Field label="Household message">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                maxLength={800}
                placeholder="Write a message to everyone"
              />
            </Field>
            <button className="btn" disabled={busy || !draft.trim()}>{busy ? "Sending…" : "Send"}</button>
          </form>
        </article>

        <article className="member-feed">
          <h2>Household members</h2>
          <p className="lede">Choose a person to see their books this month.</p>
          <div className="filter-bar" role="group" aria-label="Members">
            {members.map((row) => (
              <button
                key={row.id}
                type="button"
                className={row.id === person?.id ? "filter on" : "filter"}
                aria-pressed={row.id === person?.id}
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
                  <p className="lede">{person.role === "admin" ? "Admin of this household" : "Member of this household"}</p>
                </div>
                <span className="tag">{person.role === "admin" ? "admin" : "member"}</span>
              </div>
              <p className="hint">{monthLabel(person.month)} · {person.id === session.user.id ? "your books" : "visible to the whole house"}</p>
              <div className="member-kpis">
                <div><span>Income</span><Money cents={person.income_cents} currency={currency} /></div>
                <div><span>Spending</span><Money cents={(person.expense_cents || 0) + (person.cost_cents || 0)} currency={currency} /></div>
                <div><span>Savings</span><Money cents={person.savings_cents} currency={currency} /></div>
                <div><span>Surplus</span><Money cents={person.surplus_cents} currency={currency} signed /></div>
              </div>

              <h3>Savings pots</h3>
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

              <h3>Projects</h3>
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
                <div className="member-admin">
                  <p className="hint">New people sign up and join with a code from Settings. They are not added by name.</p>
                  <Link className="btn-ghost" to="/settings">Issue a join code</Link>
                  {person.id !== session.user.id && (
                    <div className="row" style={{ marginTop: 10, flexWrap: "wrap" }}>
                      {person.role === "admin" ? (
                        <button className="btn-ghost" type="button" disabled={busy} onClick={() => changeRole(person, "member")}>Make member</button>
                      ) : (
                        <button className="btn-ghost" type="button" disabled={busy} onClick={() => changeRole(person, "admin")}>Make admin</button>
                      )}
                      <button className="btn-ghost" type="button" disabled={busy} onClick={() => drop(person)}>Remove</button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </article>
      </section>
    </>
  );
}
