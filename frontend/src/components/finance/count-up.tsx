"use client";

import { useEffect, useRef, useState } from "react";
import { formatAmount, minorToAmount, type Money } from "@/lib/money";

/** Animates integer minor units; the final frame is the exact API string. */
export function CountUp({ value, className }: { value: Money; className?: string }) {
  const [shown, setShown] = useState(() => formatAmount(value.amount, value.currency));
  const from = useRef(0);
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const target = value.minor;
    const start = from.current;
    if (reduce || start === target) {
      setShown(formatAmount(value.amount, value.currency));
      from.current = target;
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const dur = 900;
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / dur);
      const e = 1 - Math.pow(1 - p, 4);
      if (p < 1) {
        setShown(formatAmount(minorToAmount(Math.round(start + (target - start) * e), value.currency), value.currency));
        raf = requestAnimationFrame(tick);
      } else {
        setShown(formatAmount(value.amount, value.currency));
        from.current = target;
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value.minor, value.amount, value.currency]);
  return (
    <span className={className} aria-label={formatAmount(value.amount, value.currency)}>
      {shown}
    </span>
  );
}
