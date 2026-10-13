import { useEffect, useRef, useState } from "react";
import { OmhMark } from "./ui.jsx";

export function Opening({ onDone }) {
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  const [phase, setPhase] = useState("in");
  const [skip] = useState(() => {
    if (typeof window === "undefined") return true;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches || sessionStorage.getItem("omh.intro") === "done";
  });

  useEffect(() => {
    if (skip) {
      sessionStorage.setItem("omh.intro", "done");
      doneRef.current();
      return undefined;
    }
    const show = window.setTimeout(() => setPhase("show"), 180);
    const fade = window.setTimeout(() => setPhase("fade"), 1500);
    const end = window.setTimeout(finish, 1900);
    return () => [show, fade, end].forEach((id) => window.clearTimeout(id));
  }, [skip]);

  function finish() {
    sessionStorage.setItem("omh.intro", "done");
    doneRef.current();
  }

  if (skip) return null;

  return (
    <div className={`genesis genesis-${phase}`} role="dialog" aria-modal="true" aria-label="Opening Our Money Hub">
      <div className="genesis-core">
        <div className="opening-mark"><OmhMark /></div>
        <p>Our Money Hub</p>
        <span>Private household books</span>
      </div>
      <button className="opening-skip" type="button" onClick={finish}>Skip</button>
    </div>
  );
}
