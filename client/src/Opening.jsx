import { useEffect, useState } from "react";
import { OmhMark } from "./ui.jsx";

export function Opening({ onDone }) {
  const [phase, setPhase] = useState("idle");

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || sessionStorage.getItem("omh.intro") === "done") {
      onDone();
      return undefined;
    }
    const start = window.setTimeout(() => setPhase("crack"), 700);
    const open = window.setTimeout(() => setPhase("open"), 1700);
    const light = window.setTimeout(() => setPhase("flood"), 2800);
    const end = window.setTimeout(() => finish(), 4300);
    return () => {
      window.clearTimeout(start);
      window.clearTimeout(open);
      window.clearTimeout(light);
      window.clearTimeout(end);
    };
  }, []);

  function finish() {
    sessionStorage.setItem("omh.intro", "done");
    onDone();
  }

  return (
    <div className={`opening opening-${phase}`} role="dialog" aria-label="Opening Our Money Hub">
      <div className="opening-light" />
      <div className="opening-rays" />
      <div className="door door-left">
        <div className="door-face">
          <span>OUR</span>
          <b>O</b>
        </div>
      </div>
      <div className="door door-right">
        <div className="door-face">
          <span>HUB</span>
          <b>H</b>
        </div>
      </div>
      <div className="opening-seal">
        <div className="brand-mark opening-mark"><OmhMark live /></div>
        <p>Our Money Hub</p>
      </div>
      <button className="opening-skip" type="button" onClick={finish}>Skip</button>
    </div>
  );
}
