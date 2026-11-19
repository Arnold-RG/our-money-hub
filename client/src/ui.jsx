import { money } from "./format.js";

export function Icon({ name }) {
  const paths = {
    home: "M4 11.5 12 4l8 7.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1z",
    in: "M12 4v12m0 0-4-4m4 4 4-4M5 20h14",
    out: "M12 20V8m0 0-4 4m4-4 4 4M5 4h14",
    save: "M6 20V8l6-4 6 4v12H6zm4-7h4",
    project: "M4 7h16v13H4zM8 7V4h8v3",
    calc: "M6 4h12v16H6zM8 8h8M8 12h3m2 0h3m-8 4h3m2 0h3",
    board: "M5 5h4v14H5zM10 5h4v9h-4zM15 5h4v11h-4z",
    people: "M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm8 1a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM4 19a4 4 0 0 1 8 0m4-1a3.5 3.5 0 0 1 6 0",
    chat: "M5 6h14v10H8l-3 3V6z",
    gear: "M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM12 3v2m0 14v2M4.2 6.2l1.4 1.4m12.8 12.8 1.4 1.4M3 12h2m14 0h2M4.2 17.8l1.4-1.4m12.8-12.8 1.4-1.4",
    more: "M6 12h.01M12 12h.01M18 12h.01",
    idea: "M12 3a6 6 0 0 1 4 10c0 2-1 3-2 4h-4c-1-1-2-2-2-4a6 6 0 0 1 4-10zm-2 16h4m-3 2h2",
  };
  return (
    <svg className="nav-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d={paths[name] || paths.home} />
    </svg>
  );
}

export function OmhMark({ live = false }) {
  const gid = live ? "omhGoldLive" : "omhGoldStill";
  return (
    <svg className={live ? "omh-live" : ""} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#ffe7a0" />
          <stop offset="50%" stopColor="#c9a227" />
          <stop offset="100%" stopColor="#8b6914" />
        </linearGradient>
      </defs>
      <circle className="omh-ring" cx="32" cy="32" r="29" fill="none" stroke={`url(#${gid})`} strokeWidth="3" />
      <circle cx="32" cy="32" r="22.5" fill="#0b1220" />
      <circle className="omh-spark" cx="32" cy="32" r="26" fill="none" stroke="#ffe7a0" strokeWidth="1.4" strokeDasharray="12 48" />
      <path d="M18 40V24h5l9 11 9-11h5v16h-5V30l-9 11-9-11v10h-5z" fill="#f6f1e6" />
    </svg>
  );
}

export function Money({ cents, currency, signed }) {
  const value = Number(cents) || 0;
  const cls = signed ? (value >= 0 ? "pos" : "neg") : "";
  return <div className={`money ${cls}`}>{money(value, currency)}</div>;
}

export function Field({ label, children, wide }) {
  return (
    <label className={`field ${wide ? "wide" : ""}`}>
      <span>{label}</span>
      {children}
    </label>
  );
}

export function Modal({ title, onClose, children, footer }) {
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
          <h3>{title}</h3>
          <button className="btn-ghost btn-small" onClick={onClose} type="button">Close</button>
        </div>
        {children}
        {footer ? <div className="row" style={{ marginTop: 16, justifyContent: "flex-end" }}>{footer}</div> : null}
      </div>
    </div>
  );
}

export function Empty({ title, text, action }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      <p>{text}</p>
      {action}
    </div>
  );
}

export function Progress({ value }) {
  return (
    <div className="progress" aria-hidden="true">
      <i style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

export function MonthNav({ month, onChange, label }) {
  return (
    <div className="month-nav">
      <button className="btn-ghost btn-small" type="button" onClick={() => onChange(-1)} aria-label="Previous month">‹</button>
      <strong>{label}</strong>
      <button className="btn-ghost btn-small" type="button" onClick={() => onChange(1)} aria-label="Next month">›</button>
    </div>
  );
}

export function Notice({ error, ok }) {
  if (!error && !ok) return null;
  return <div className={`notice ${ok ? "ok" : ""}`}>{error || ok}</div>;
}
