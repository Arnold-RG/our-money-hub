"use client";

import { useEffect, useState } from "react";

/** CSS pixel box of the visual viewport (shrinks when the on-screen keyboard opens). */
export function useVisualViewportBox() {
  const [box, setBox] = useState({ top: 0, height: 0, ready: false });
  useEffect(() => {
    const apply = () => {
      const vv = window.visualViewport;
      setBox({
        top: vv?.offsetTop ?? 0,
        height: vv?.height ?? window.innerHeight,
        ready: true,
      });
    };
    apply();
    const vv = window.visualViewport;
    vv?.addEventListener("resize", apply);
    vv?.addEventListener("scroll", apply);
    window.addEventListener("resize", apply);
    return () => {
      vv?.removeEventListener("resize", apply);
      vv?.removeEventListener("scroll", apply);
      window.removeEventListener("resize", apply);
    };
  }, []);
  return box;
}

export function useIsDesktop(query = "(min-width: 768px)") {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    const m = window.matchMedia(query);
    const upd = () => setOk(m.matches);
    upd();
    m.addEventListener("change", upd);
    return () => m.removeEventListener("change", upd);
  }, [query]);
  return ok;
}
