"use client";
import { useEffect, useState, type ReactNode } from "react";

/** Sticky one-line filter bar with an optional saved view in localStorage. */
export function FilterBar({ storageKey, children, onLoad }: { storageKey: string; children: ReactNode; onLoad?: (raw: string | null) => void }) {
  const [saved, setSaved] = useState(false);
  useEffect(() => { onLoad?.(typeof window !== "undefined" ? localStorage.getItem(storageKey) : null); }, [storageKey, onLoad]);
  const save = () => {
    const form = document.getElementById(storageKey);
    const data = form instanceof HTMLElement ? form.dataset.view ?? "{}" : "{}";
    localStorage.setItem(storageKey, data);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };
  return (
    <div id={storageKey} className="filters" role="search">
      {children}
      <span className="sp flex-1" />
      <button type="button" className="chip" onClick={save} aria-label="Save this view">{saved ? "Saved" : "Save view"}</button>
    </div>
  );
}
