import { useEffect, useState } from "react";
import { OmhMark } from "./ui.jsx";

export function Opening({ onDone }) {
  const [phase, setPhase] = useState("spark");

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || sessionStorage.getItem("omh.intro") === "done") {
      onDone();
      return undefined;
    }
    const ring = window.setTimeout(() => setPhase("rings"), 400);
    const coin = window.setTimeout(() => setPhase("coin"), 1100);
    const word = window.setTimeout(() => setPhase("word"), 2000);
    const fade = window.setTimeout(() => setPhase("fade"), 3000);
    const end = window.setTimeout(() => finish(), 3800);
    return () => [ring, coin, word, fade, end].forEach((id) => window.clearTimeout(id));
  }, []);

  function finish() {
    sessionStorage.setItem("omh.intro", "done");
    onDone();
  }

  return (
    <div className={`genesis genesis-${phase}`} role="dialog" aria-label="Opening Our Money Hub">
      <div className="genesis-sky" />
      <div className="genesis-bloom" />
      {Array.from({ length: 18 }).map((_, i) => <i key={i} className={`dust dust-${i + 1}`} />)}
      <div className="genesis-ring r1" />
      <div className="genesis-ring r2" />
      <div className="genesis-ring r3" />
      <div className="genesis-core">
        <div className="brand-mark opening-mark"><OmhMark live /></div>
        <p>Our Money Hub</p>
        <span>Private household books</span>
      </div>
      <button className="opening-skip" type="button" onClick={finish}>Skip</button>
    </div>
  );
}
