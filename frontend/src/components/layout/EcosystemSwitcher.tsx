"use client";
import { ArrowUpRight } from "lucide-react";
import { ragiPublicUrl } from "@/lib/ecosystem-urls";

const RAGI_URL = ragiPublicUrl();

/** Our Money Hub ⇄ RAGI. Separate apps, accounts and sessions — no shared SSO. */
export function EcosystemSwitcher() {
  return (
    <div className="flex rounded-xl border border-line bg-surface-2 p-1 text-xs">
      <a href={RAGI_URL} className="flex flex-1 items-center justify-center gap-1 rounded-lg px-2.5 py-1.5 text-muted hover:text-ink" title="Opens RAGI. It uses a separate account and session.">
        RAGI <ArrowUpRight size={12} />
      </a>
      <span className="flex-1 rounded-lg bg-surface-3 px-2.5 py-1.5 text-center font-semibold">Money Hub</span>
    </div>
  );
}
