"use client";

import Link from "next/link";
import { ChevronRight, LogOut, Moon, Sun } from "lucide-react";
import { MORE } from "@/components/layout/nav";
import { CurrencyLens } from "@/components/layout/shell";
import { useApp } from "@/providers/app-provider";
import { Card } from "@/components/ui";
import { PageHeader } from "@/components/finance/page-header";

export default function MorePage() {
  const { theme, toggleTheme, signOut, me } = useApp();
  return (
    <>
      <PageHeader eyebrow="More" title="Everything else" />
      <Card className="p-2 sm:p-2">
        <ul className="divide-y divide-line">
          {MORE.map(({ href, label, icon: Icon, hint }) => (
            <li key={href}>
              <Link href={href} className="flex min-h-[56px] items-center gap-3 rounded-2xl px-3 py-3 hover:bg-surface-2">
                <span className="grid size-10 place-items-center rounded-2xl bg-accent/12 text-accent">
                  <Icon size={18} />
                </span>
                <span className="flex-1">
                  <span className="block text-sm font-medium">{label}</span>
                  <span className="block text-xs text-faint">{hint}</span>
                </span>
                <ChevronRight size={16} className="text-faint" />
              </Link>
            </li>
          ))}
        </ul>
      </Card>
      <Card className="mt-4 flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-medium">Reporting currency</span>
          <CurrencyLens compact />
        </div>
        <button onClick={toggleTheme} className="hit flex items-center justify-between text-sm font-medium">
          {theme === "dark" ? "Light theme" : "Dark theme"} {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
        </button>
        <button onClick={signOut} className="hit flex items-center justify-between text-sm font-medium text-danger">
          Sign out {me?.is_demo ? "(ends the demo)" : ""} <LogOut size={17} />
        </button>
      </Card>
      <p className="mt-8 text-center text-xs text-faint">Our Money Hub · Created by Arnold Rurangwa / Arnova Group</p>
    </>
  );
}
