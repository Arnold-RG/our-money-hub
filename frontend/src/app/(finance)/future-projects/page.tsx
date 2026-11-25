"use client";

import { useState } from "react";
import { CalendarRange, Plus } from "lucide-react";
import { api, type Money } from "@/lib/api";
import { refreshAll, useApp } from "@/providers/app-provider";
import { useWs } from "@/lib/hooks";
import { CURRENCIES, CURRENCY_LABEL, formatAmount, fmt, type Currency } from "@/lib/money";

/** Planned: no sign. Funded: +. Gap (a shortfall): always −. Zero: no sign. */
function fmtGap(m: Money) {
  if (!m || m.minor === 0) return formatAmount("0", m.currency);
  const raw = m.amount.startsWith("-") ? m.amount.slice(1) : m.amount;
  return `−${formatAmount(raw, m.currency)}`;
}

import { Button, EmptyState, ErrorNote, Field, Input, Progress, Select, Skeleton } from "@/components/ui";
import { PageHeader } from "@/components/finance/page-header";

interface Future {
  id: string; name: string; planned: Money; funded: Money; gap: Money; currency: Currency;
  target_date: string | null; notes: string | null; behind: boolean; funded_fully: boolean;
}

export default function FutureProjectsPage() {
  const { data, isLoading } = useWs<Future[]>("/future-projects");
  const { workspace } = useApp();
  const canEdit = workspace?.role === "owner" || workspace?.role === "editor";
  const [name, setName] = useState("");
  const [planned, setPlanned] = useState("");
  const [funded, setFunded] = useState("0");
  const [currency, setCurrency] = useState<Currency>("PLN");
  const [target, setTarget] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await api("/future-projects", { method: "POST", json: { name, planned, funded: funded || "0", currency, target_date: target || null } });
      setName(""); setPlanned(""); setFunded("0"); setTarget("");
      await refreshAll();
    } catch (err) {
      setError((err as Error).message);
    } finally { setBusy(false); }
  };

  return (
    <>
      <PageHeader
        eyebrow="Future projects"
        title="Planned work, with funding"
        subtitle="Money lives here, with a PLN default. Funding progress is separate from any monthly budget-versus-actual view."
      />
      {canEdit && (
        <form onSubmit={add} className="card mb-5 grid gap-3 p-4 md:grid-cols-5">
          <Field label="Project">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} required />}</Field>
          <Field label="Planned">{(id) => <Input id={id} inputMode="decimal" value={planned} onChange={(e) => setPlanned(e.target.value)} required />}</Field>
          <Field label="Funded">{(id) => <Input id={id} inputMode="decimal" value={funded} onChange={(e) => setFunded(e.target.value)} />}</Field>
          <Field label="Currency">
            {(id) => (
              <Select id={id} value={currency} onChange={(e) => setCurrency(e.target.value as Currency)}>
                {CURRENCIES.map((c) => <option key={c} value={c}>{c} · {CURRENCY_LABEL[c]}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Target date">{(id) => <Input id={id} type="date" value={target} onChange={(e) => setTarget(e.target.value)} />}</Field>
          <div className="md:col-span-5 flex items-center gap-3">
            <Button type="submit" disabled={busy} icon={<Plus size={16} />}>{busy ? "Adding…" : "Add project"}</Button>
            <ErrorNote error={error} />
          </div>
        </form>
      )}

      {isLoading && <Skeleton className="h-40" />}
      {data && data.length === 0 && (
        <EmptyState icon={<CalendarRange size={20} />} title="No future projects yet" body="Add a name, a planned amount in PLN (or another currency), how much is already funded, and an optional target date." />
      )}
      {data && data.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2">
          {data.map((p) => {
            const denom = p.planned.minor || 1;
            const fundedPct = Math.max(0, Math.round((p.funded.minor / denom) * 100));
            return (
              <article key={p.id} className="card p-4">
                <div className="flex items-start justify-between gap-3">
                  <h2 className="m-0 text-base font-semibold">{p.name}</h2>
                  {p.behind && <span className="text-xs text-warning" role="status">Behind target</span>}
                  {p.funded_fully && <span className="text-xs text-accent">Fully funded</span>}
                </div>
                <dl className="tnum mt-3 grid grid-cols-3 gap-2 text-sm">
                  <div><dt className="text-faint">Planned</dt><dd className="font-semibold">{fmt(p.planned)}</dd></div>
                  <div><dt className="text-faint">Funded</dt><dd className="font-semibold">{fmt(p.funded, { sign: true })}</dd></div>
                  <div><dt className="text-faint">Gap</dt><dd className="font-semibold">{fmtGap(p.gap)}</dd></div>
                </dl>
                <div className="mt-3">
                  <p className="mb-1 text-xs uppercase tracking-wide text-faint">Funding progress</p>
                  <Progress value={Math.min(100, fundedPct)} tone={p.funded_fully ? "accent" : p.behind ? "warning" : "accent"} label={`${p.name} funding progress`} />
                  <p className="mt-1 text-xs text-faint">{fundedPct}% funded{p.target_date ? ` · target ${p.target_date}` : ""}</p>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}
