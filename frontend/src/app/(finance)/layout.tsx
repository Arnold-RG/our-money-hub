"use client";

import { AppShell } from "@/components/layout/shell";
import { Logo } from "@/components/layout/logo";
import { useApp } from "@/providers/app-provider";

export default function FinanceLayout({ children }: { children: React.ReactNode }) {
  const { me } = useApp();
  if (!me) {
    return (
      <div className="grid min-h-dvh place-items-center" aria-busy="true">
        <div className="flex flex-col items-center gap-3 text-sm text-muted">
          <Logo size={44} />
          Opening your books…
        </div>
      </div>
    );
  }
  return <AppShell>{children}</AppShell>;
}
