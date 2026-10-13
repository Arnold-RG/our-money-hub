import { useEffect, useId, useRef, useState } from "react";
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
    <svg className="nav-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={paths[name] || paths.home} />
    </svg>
  );
}

export function OmhMark() {
  return (
    <svg className="mark" viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="16" fill="#14312c" />
      <rect x="5.5" y="5.5" width="53" height="53" rx="12" fill="none" stroke="#c6a36a" strokeWidth="1.2" />
      <path d="M17.5 46.5V19.5h6.4L32 34.6l8.1-15.1h6.4v27h-5.4V28.8L32 42.2l-9.1-13.4v17.7h-5.4z" fill="#f6f1e7" />
      <rect x="46" y="46" width="7" height="7" rx="1.2" fill="#c6a36a" />
    </svg>
  );
}

export function Money({ cents, currency, signed }) {
  const value = Number(cents) || 0;
  const cls = signed ? (value > 0 ? "pos" : value < 0 ? "neg" : "") : "";
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
  const ref = useRef(null);
  const titleId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const node = ref.current;
    const previous = document.activeElement;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusables = () => [...node.querySelectorAll("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])")].filter((el) => !el.disabled);
    const field = focusables().find((el) => el.matches("input, select, textarea"));
    (field || focusables()[0])?.focus();
    function onKey(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusables();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      previous?.focus?.();
    };
  }, []);

  return (
    <div className="modal-back" onMouseDown={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={ref}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="row spread">
          <h3 id={titleId}>{title}</h3>
          <button className="btn-ghost btn-small" onClick={onClose} type="button">Close</button>
        </div>
        {children}
        {footer ? <div className="row modal-footer">{footer}</div> : null}
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

export function Progress({ value, label = "Progress" }) {
  const width = Math.max(0, Math.min(100, Math.round(value || 0)));
  return (
    <div className="progress" role="progressbar" aria-valuenow={width} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <i style={{ width: `${width}%` }} />
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
  return <div className={`notice ${ok ? "ok" : ""}`} role={error ? "alert" : "status"}>{error || ok}</div>;
}

export function useNarrow(max = 760) {
  const query = `(max-width: ${max}px)`;
  const [on, setOn] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const listen = () => setOn(media.matches);
    listen();
    media.addEventListener("change", listen);
    return () => media.removeEventListener("change", listen);
  }, [query]);
  return on;
}
