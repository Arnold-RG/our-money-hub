import { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import { PLAN_LABELS } from "../catalogs.js";
import { prettyDate } from "../format.js";
import { Empty, Field, Modal, Notice } from "../ui.jsx";

export function Plans({ session }) {
  const [board, setBoard] = useState({ lists: [], cards: [] });
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(null);
  const [column, setColumn] = useState("");
  const [busy, setBusy] = useState(false);
  const members = session.members.filter((m) => m.role !== "guest");

  async function load() {
    setBoard(await api.board());
  }

  useEffect(() => {
    load().catch((err) => setError(err.message));
  }, []);

  const cardsByList = useMemo(() => {
    const map = {};
    for (const list of board.lists) map[list.id] = [];
    for (const card of board.cards) {
      if (!map[card.listId]) map[card.listId] = [];
      map[card.listId].push(card);
    }
    for (const id of Object.keys(map)) map[id].sort((a, b) => a.order - b.order);
    return map;
  }, [board]);

  async function saveCard() {
    setBusy(true);
    setError("");
    try {
      if (editing.id) await api.updateCard(editing.id, editing);
      else await api.addCard(editing);
      setEditing(null);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function onDrop(listId) {
    return async (event) => {
      event.preventDefault();
      const id = event.dataTransfer.getData("text/plain");
      if (!id) return;
      await api.moveCard(id, listId);
      await load();
    };
  }

  return (
    <>
      <header className="page-head">
        <div>
          <p className="kicker">The family board</p>
          <h2>Plans</h2>
          <p className="lede">Write the whole path of a project — how it starts, what happens in the middle, and how it ends. Drag a card when the work moves.</p>
        </div>
        <div className="row">
          <input className="inline-input" value={column} placeholder="New column" onChange={(e) => setColumn(e.target.value)} />
          <button className="btn-ghost" onClick={async () => {
            if (!column.trim()) return;
            await api.addList(column);
            setColumn("");
            await load();
          }}>Add column</button>
          <button className="btn" onClick={() => setEditing({
            title: "", plan: "", listId: board.lists[0]?.id, labels: [], ownerId: session.user.id, due: "", checklist: [],
          })}>New plan card</button>
        </div>
      </header>
      <Notice error={error} />

      {board.lists.length === 0 ? (
        <div className="card"><Empty title="No board yet" text="Add the first column and start the plan." /></div>
      ) : (
        <div className="board">
          {board.lists.map((list) => (
            <section
              key={list.id}
              className="board-col"
              onDragOver={(event) => event.preventDefault()}
              onDrop={onDrop(list.id)}
            >
              <div className="board-col-head">
                <h3>{list.title}</h3>
                <button className="btn-ghost btn-small" onClick={async () => {
                  if (!window.confirm("Remove this column and its cards?")) return;
                  await api.deleteList(list.id);
                  await load();
                }}>×</button>
              </div>
              <div className="board-cards">
                {(cardsByList[list.id] || []).map((card) => (
                  <article
                    key={card.id}
                    className="plan-card"
                    draggable
                    onDragStart={(event) => event.dataTransfer.setData("text/plain", card.id)}
                    onClick={() => setEditing({ ...card, due: card.due || "" })}
                  >
                    <div className="label-row">
                      {card.labels.map((label) => <span key={label} className={`chip chip-${label.toLowerCase()}`}>{label}</span>)}
                    </div>
                    <strong>{card.title}</strong>
                    {card.plan ? <p>{card.plan.slice(0, 140)}{card.plan.length > 140 ? "…" : ""}</p> : null}
                    <div className="plan-meta">
                      <span>{card.owner_name}</span>
                      {card.due ? <span>{prettyDate(card.due)}</span> : null}
                      {card.checklist?.length ? <span>{card.checklist.filter((item) => item.done).length}/{card.checklist.length}</span> : null}
                    </div>
                  </article>
                ))}
                <button className="ghost-add" onClick={() => setEditing({
                  title: "", plan: "", listId: list.id, labels: [], ownerId: session.user.id, due: "", checklist: [],
                })}>+ Add a card</button>
              </div>
            </section>
          ))}
        </div>
      )}

      {editing && (
        <Modal
          title={editing.id ? "Plan card" : "New plan card"}
          onClose={() => setEditing(null)}
          footer={(
            <>
              {editing.id && <button className="btn-danger" onClick={async () => {
                if (!window.confirm("Delete this plan card?")) return;
                await api.deleteCard(editing.id);
                setEditing(null);
                await load();
              }}>Delete</button>}
              <button className="btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
              <button className="btn" disabled={busy} onClick={saveCard}>{busy ? "Saving…" : "Save plan"}</button>
            </>
          )}
        >
          <div className="form-grid">
            <Field label="Title" wide>
              <input value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} />
            </Field>
            <Field label="Column">
              <select value={editing.listId} onChange={(e) => setEditing({ ...editing, listId: e.target.value })}>
                {board.lists.map((list) => <option key={list.id} value={list.id}>{list.title}</option>)}
              </select>
            </Field>
            <Field label="Lead">
              <select value={editing.ownerId} onChange={(e) => setEditing({ ...editing, ownerId: e.target.value })}>
                {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </Field>
            <Field label="Target date">
              <input type="date" value={editing.due || ""} onChange={(e) => setEditing({ ...editing, due: e.target.value })} />
            </Field>
            <Field label="The full plan — start to finish" wide>
              <textarea
                value={editing.plan || ""}
                onChange={(e) => setEditing({ ...editing, plan: e.target.value })}
                placeholder="1. How we start&#10;2. What we do next&#10;3. How we finish and how we pay for it"
                style={{ minHeight: 180 }}
              />
            </Field>
            <div className="wide">
              <span className="hint">Labels</span>
              <div className="label-row" style={{ marginTop: 8 }}>
                {PLAN_LABELS.map((label) => {
                  const on = (editing.labels || []).includes(label);
                  return (
                    <button
                      key={label}
                      type="button"
                      className={`chip chip-${label.toLowerCase()} ${on ? "on" : ""}`}
                      onClick={() => setEditing({
                        ...editing,
                        labels: on ? editing.labels.filter((item) => item !== label) : [...(editing.labels || []), label],
                      })}
                    >{label}</button>
                  );
                })}
              </div>
            </div>
            <div className="wide">
              <span className="hint">Checklist</span>
              <div className="check-list">
                {(editing.checklist || []).map((item, index) => (
                  <label className="check" key={item.id || index}>
                    <input
                      type="checkbox"
                      checked={Boolean(item.done)}
                      onChange={(e) => {
                        const checklist = [...editing.checklist];
                        checklist[index] = { ...item, done: e.target.checked };
                        setEditing({ ...editing, checklist });
                      }}
                    />
                    <input
                      value={item.text}
                      onChange={(e) => {
                        const checklist = [...editing.checklist];
                        checklist[index] = { ...item, text: e.target.value };
                        setEditing({ ...editing, checklist });
                      }}
                    />
                  </label>
                ))}
                <button className="btn-ghost btn-small" type="button" onClick={() => setEditing({
                  ...editing,
                  checklist: [...(editing.checklist || []), { id: `${Date.now()}`, text: "Next step", done: false }],
                })}>Add a step</button>
              </div>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
