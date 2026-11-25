"use client";

import { useMemo, useState } from "react";
import { PiggyBank, Plus } from "lucide-react";
import { api, type Money } from "@/lib/api";
import { refreshAll } from "@/providers/app-provider";
import { useWs } from "@/lib/hooks";
import { CURRENCIES, CURRENCY_LABEL, formatAmount, fmt, minorToAmount, type Currency } from "@/lib/money";
import { Button, EmptyState, ErrorNote, Field, Input, Select, Skeleton } from "@/components/ui";
import { PageHeader } from "@/components/finance/page-header";

interface Entry {
  id: string; category: "income" | "living" | "usage" | "savings"; label: string;
  amount_minor: number; currency: Currency; occurred_on: string; notes: string | null; is_refund: boolean;
}

interface Pnl {
  period_start: string; period_end: string; reporting_currency: Currency; basis: string; rounding: string; formula: string;
  empty: boolean; income: Money; living: Money; usage: Money; savings: Money; net: Money;
  pnl_pct: string | null; savings_rate_pct: string | null;
  counts: Record<string, number>; stale_currencies: string[]; unconverted: string[]; entries: Entry[];
}

const CATS = [
  { id: "income", label: "Income" },
  { id: "living", label: "Living expenses" },
  { id: "usage", label: "Usage expenses" },
  { id: "savings", label: "Savings" },
] as const;

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function pct(v: string | null) {
  return v == null ? "—" : `${v}%`;
}

export default function MyFinancesPage() {
  const [period, setPeriod] = useState(currentMonth);
  const { data, isLoading } = useWs<Pnl>(`/my-finances?period=${period}`, true);
  const [category, setCategory] = useState<(typeof CATS)[number]["id"]>("income");
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState<Currency>("PLN");
  const [occurred, setOccurred] = useState(new Date().toISOString().slice(0, 10));
  const [isRefund, setIsRefund] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loss = (data?.net.minor ?? 0) < 0;
  const byCat = useMemo(() => {
    const m: Record<string, Entry[]> = { income: [], living: [], usage: [], savings: [] };
    for (const e of data?.entries ?? []) m[e.category]?.push(e);
    return m;
  }, [data]);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await api("/my-finances/entries", { method: "POST", json: { category, label, amount, currency, occurred_on: occurred, is_refund: isRefund } });
      setLabel(""); setAmount(""); setIsRefund(false);
      await refreshAll();
    } catch (err) {
      setError((err as Error).message);
    } finally { setBusy(false); }
  };

  return (
    <>
      <PageHeader
        eyebrow="My finances"
        title="Personal P&L"
        subtitle="Cash basis. N = I − (L + U). Refunds reduce their original category on the refund date. Rounding is half-up, once, after summing exact converted amounts. Official rates are used as published."
        actions={<input className="input" type="month" value={period} onChange={(e) => setPeriod(e.target.value)} aria-label="Period" />}
      />

      {isLoading && <Skeleton className="h-48" />}
      {data?.empty && (
        <EmptyState icon={<PiggyBank size={20} />} title="No records this period" body="Add income, living expenses, usage expenses or savings to see a profit-and-loss summary. Nothing is invented while the list is empty." />
      )}

      {data && !data.empty && (
        <div className="grid gap-4 md:grid-cols-4">
          {[
            ["Income (I)", data.income],
            ["Living (L)", data.living],
            ["Usage (U)", data.usage],
            ["Savings (S)", data.savings],
          ].map(([k, v]) => (
            <div key={k as string} className="card p-4">
              <div className="text-xs uppercase tracking-wide text-faint">{k as string}</div>
              <div className="tnum mt-1 text-2xl font-semibold">{fmt(v as Money)}</div>
            </div>
          ))}
          <div className="card p-4 md:col-span-2" style={loss ? { borderColor: "var(--danger, #b42318)" } : undefined}>
            <div className="text-xs uppercase tracking-wide text-faint">Net (N)</div>
            <div className={`tnum mt-1 text-3xl font-semibold ${loss ? "text-danger" : ""}`}>{fmt(data.net)}</div>
            <p className="mt-1 text-xs text-faint">I − (L + U){loss ? " · this period is a loss" : ""}</p>
          </div>
          <div className="card p-4">
            <div className="text-xs uppercase tracking-wide text-faint">P&L %</div>
            <div className="tnum mt-1 text-3xl font-semibold">{pct(data.pnl_pct)}</div>
            <p className="mt-1 text-xs text-faint">N / I × 100. A dash means income is 0.</p>
          </div>
          <div className="card p-4">
            <div className="text-xs uppercase tracking-wide text-faint">Savings rate</div>
            <div className="tnum mt-1 text-3xl font-semibold">{pct(data.savings_rate_pct)}</div>
            <p className="mt-1 text-xs text-faint">S / I × 100. A dash means income is 0.</p>
          </div>
        </div>
      )}

      {data && data.stale_currencies.length > 0 && (
        <p className="text-sm text-warning" role="status">Some amounts used a rate older than 2 Polish business days ({data.stale_currencies.join(", ")}). They still converted; the date is on the currency switcher.</p>
      )}
      {data && data.unconverted.length > 0 && (
        <p className="text-sm text-warning" role="status">No official rate on file for {data.unconverted.join(", ")}, so those entries are left out of the totals.</p>
      )}

      <form onSubmit={add} className="card mt-4 grid gap-3 p-4 md:grid-cols-5">
        <Field label="Category">
          {(id) => (
            <Select id={id} value={category} onChange={(e) => setCategory(e.target.value as typeof category)}>
              {CATS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Label">{(id) => <Input id={id} value={label} onChange={(e) => setLabel(e.target.value)} required />}</Field>
        <Field label="Amount">{(id) => <Input id={id} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required />}</Field>
        <Field label="Currency">
          {(id) => (
            <Select id={id} value={currency} onChange={(e) => setCurrency(e.target.value as Currency)}>
              {CURRENCIES.map((c) => <option key={c} value={c}>{c} · {CURRENCY_LABEL[c]}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Date">{(id) => <Input id={id} type="date" value={occurred} onChange={(e) => setOccurred(e.target.value)} required />}</Field>
        <label className="md:col-span-5 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={isRefund} onChange={(e) => setIsRefund(e.target.checked)} className="size-4 accent-[var(--omh-accent)]" />
          This is a refund (reduces this category on this date)
        </label>
        <div className="md:col-span-5 flex items-center gap-3">
          <Button type="submit" disabled={busy} icon={<Plus size={16} />}>{busy ? "Adding…" : "Add entry"}</Button>
          <ErrorNote error={error} />
        </div>
      </form>

      {data && !data.empty && CATS.map((c) => (
        <section key={c.id} className="mt-6">
          <h2 className="text-sm font-semibold">{c.label} <span className="font-normal text-faint">{data.counts[c.id] ?? 0}</span></h2>
          {(byCat[c.id] ?? []).length === 0 ? (
            <p className="mt-2 text-sm text-muted">None this period.</p>
          ) : (
            <div className="card mt-2 overflow-x-auto p-0">
              <table className="w-full text-sm">
                <thead><tr className="border-b text-left text-xs uppercase text-faint" style={{ borderColor: "var(--border)" }}>
                  <th className="px-4 py-2">Date</th><th className="px-4 py-2">Label</th><th className="px-4 py-2 text-right">Amount</th>
                </tr></thead>
                <tbody>
                  {byCat[c.id].map((e) => (
                    <tr key={e.id} className="border-b" style={{ borderColor: "var(--border)" }}>
                      <td className="px-4 py-2 tnum">{e.occurred_on}</td>
                      <td className="px-4 py-2">{e.label}{e.is_refund ? <span className="ml-2 text-xs text-muted">Refund</span> : null}</td>
                      <td className="px-4 py-2 tnum text-right">{e.is_refund ? "−" : ""}{formatAmount(minorToAmount(e.amount_minor, e.currency), e.currency)} {e.currency !== data.reporting_currency ? `· ${e.currency}` : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ))}
    </>
  );
}
