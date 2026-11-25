"use client";

import Link from "next/link";
import { useState } from "react";
import { AlertTriangle, ArrowLeftRight, Gauge } from "lucide-react";
import type { BudgetView, Sub, Summary, Txn } from "@/lib/api";
import { useWs } from "@/lib/hooks";
import { useApp } from "@/providers/app-provider";
import { fmt, type Currency, type Money } from "@/lib/money";
import { niceDate } from "@/lib/labels";
import { EmptyState, Modal, Skeleton } from "@/components/ui";
import { CashflowArea } from "@/components/charts";
import { AccountForm, SubForm, TxnForm } from "@/components/finance/forms";
import { PageHeader } from "@/components/finance/page-header";
import { FilterBar } from "@/components/ui/FilterBar";
import { KpiCard } from "@/components/ui/KpiCard";

interface Cashflow { currency: Currency; series: { month: string; income: Money; expense: Money; net: Money }[]; unconverted: string[] }

function budgetFill(state: BudgetView["state"]) {
  if (state === "exceeded") return "var(--danger)";
  if (state === "warning") return "var(--bar-warning)";
  return "var(--c1)";
}

export default function Dashboard() {
  const { workspace, currency } = useApp();
  const { data: s, error } = useWs<Summary>("/reports/summary", true);
  const { data: txns } = useWs<Txn[]>("/transactions?limit=20");
  const { data: subs } = useWs<Sub[]>("/subscriptions");
  const [add, setAdd] = useState<null | "account" | "txn" | "sub">(null);
  const [months, setMonths] = useState<"1" | "3" | "6" | "12">("6");
  const { data: flow } = useWs<Cashflow>(`/reports/cashflow?months=${months === "1" ? "3" : months}`, true);
  const rateNote = s && Object.keys(s.rates_used).length > 0
    ? Object.entries(s.rates_used).map(([k, v]) => `${k} at ${v.source}${v.effective_date ? ", " + niceDate(v.effective_date) : ""}`).join(" · ")
    : null;
  const inSeries = flow?.series.map((r) => r.income.minor) ?? [];
  const outSeries = flow?.series.map((r) => r.expense.minor) ?? [];
  const netSeries = flow?.series.map((r) => r.net.minor) ?? [];
  const empty = s && !s.has_data;
  const shownTx = (txns ?? []).slice(0, 5);

  return (
    <>
      <PageHeader
        title="Money overview"
        subtitle={`${workspace?.name ?? "Workspace"} · ${s?.month ?? ""}${s && !s.has_data ? " · empty" : ""}`}
        actions={<button className="btn btn-primary" onClick={() => setAdd("txn")}>+ Add payment</button>}
      />
      {error && <p role="alert" className="text-sm text-danger">Could not load this workspace.</p>}
      {!s && !error && <div className="kpis">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-28" />)}</div>}
      {s && (
        <>
          {empty && (
            <div className="card p-6">
              <h2 className="m-0 text-base font-bold">Your hub is empty and honest</h2>
              <p className="mt-1 text-sm text-muted">No sample figures. Add an account or a payment to see balances, cash flow and budgets here.</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <button className="btn btn-primary" onClick={() => setAdd("account")}>Add account</button>
                <button className="btn" onClick={() => setAdd("txn")}>Add payment</button>
              </div>
            </div>
          )}
          <div className="kpis">
            <KpiCard hero label="Total balance" value={!empty && s.total_balance ? fmt(s.total_balance) : "—"}
              series={empty ? [] : netSeries} sparkColor="var(--credit)" period="in this currency" />
            <KpiCard label="Money in" value={!empty && s.monthly_revenue && s.monthly_revenue.minor !== 0 ? <span className="credit-v">+{fmt(s.monthly_revenue)}</span> : "—"}
              series={empty ? [] : inSeries} sparkColor="var(--credit)" period="this month" />
            <KpiCard label="Money out" value={!empty && s.monthly_expenses && s.monthly_expenses.minor !== 0 ? <span className="debit-v">−{fmt(s.monthly_expenses)}</span> : "—"}
              series={empty ? [] : outSeries} sparkColor="var(--debit)" period="this month" />
            <KpiCard label="Net this month" value={!empty && s.net_cash_flow && s.net_cash_flow.minor !== 0 ? <span className={s.net_cash_flow.minor >= 0 ? "credit-v" : "debit-v"}>{fmt(s.net_cash_flow, { sign: true })}</span> : "—"}
              series={empty ? [] : netSeries} sparkColor="var(--c3)" period="income minus spending" />
          </div>
          {s.unconverted.length > 0 && (
            <p className="text-xs" style={{ color: "var(--warning-text)" }}><AlertTriangle size={12} className="inline" /> {s.unconverted.join(", ")} not converted — shown in their own currency only.</p>
          )}

          <div className="flex flex-col gap-4 lg:flex-row">
            <div className="card flex-1 p-4" style={{ flex: 1.6 }}>
              <div className="mb-2 flex items-center gap-2">
                <h3 className="m-0 text-sm font-bold">Cash flow</h3>
                <span className="faint text-xs">{currency}</span>
                <span className="flex-1" />
                <div className="seg" role="radiogroup" aria-label="Cash flow range">
                  {(["1", "3", "6", "12"] as const).map((m) => (
                    <button key={m} type="button" role="radio" aria-checked={months === m} className={months === m ? "on" : ""} onClick={() => setMonths(m)}>{m === "12" ? "1Y" : `${m}M`}</button>
                  ))}
                </div>
              </div>
              {!flow ? <Skeleton className="h-40" /> : flow.series.every((r) => r.income.minor === 0 && r.expense.minor === 0) ? (
                <EmptyState icon={<ArrowLeftRight size={18} />} title="No cash flow yet" body="Confirmed income and expenses appear here month by month." />
              ) : (
                <>
                  <CashflowArea series={flow.series} />
                  <div className="legend mt-1">
                    <span><i style={{ background: "var(--credit)" }} /> Money in (solid)</span>
                    <span><i style={{ background: "var(--debit)" }} /> Money out (dashed)</span>
                    <span className="flex-1" />
                    <Link href="/reports" className="text-xs" style={{ color: "var(--text2)" }}>View as table</Link>
                  </div>
                </>
              )}
            </div>
            <div className="card flex-1 p-4">
              <div className="mb-1 flex items-center gap-2">
                <h3 className="m-0 text-sm font-bold">Budgets · {s.month}</h3>
                <span className="flex-1" />
              </div>
              {(s.budgets ?? []).length === 0 ? (
                <EmptyState icon={<Gauge size={18} />} title="No budgets yet" body="Set a category or AI budget to track spending against a limit." action={<Link href="/budgets" className="btn">Add</Link>} />
              ) : (s.budgets ?? []).slice(0, 4).map((b) => {
                const u = Math.round(Number(b.committed_utilization) * 100);
                const fill = budgetFill(b.state);
                const pill = b.state === "exceeded" ? { cls: "err", label: `Over · ${Math.max(u - 100, 0)}%` } : b.state === "warning" ? { cls: "warn", label: `Alert · ${u}%` } : { cls: "ok", label: "On track" };
                return (
                  <div key={b.id} className="grid gap-1 border-b py-1.5" style={{ borderColor: "var(--border)" }}>
                    <div className="flex items-center gap-2 text-sm">
                      <b className="font-semibold">{b.name}</b>
                      <span className="faint num text-[11.5px]">{fmt(b.actual)} / {fmt(b.allocated)} · {u}%</span>
                      <span className="flex-1" />
                      <span className={`pill ${pill.cls}`}>{pill.label}</span>
                    </div>
                    <div className="bar-track"><i style={{ width: `${Math.min(u, 100)}%`, background: fill }} /></div>
                  </div>
                );
              })}
              <div className="flex items-center gap-2 pt-2 text-[12.5px]" style={{ color: "var(--text2)" }}>
                <span>{(subs ?? []).length === 0 ? "No subscriptions tracked yet" : `${subs?.length} subscription${subs && subs.length === 1 ? "" : "s"}`}</span>
                <span className="flex-1" />
                <button className="btn" onClick={() => setAdd("sub")}>+ Add</button>
              </div>
            </div>
          </div>

          <div className="card p-4">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <h3 className="m-0 text-sm font-bold">Recent transactions</h3>
              <span className="faint text-xs">{shownTx.length ? `Latest ${shownTx.length}${txns && txns.length > 5 ? " of many" : ""}` : "None yet"}</span>
              <span className="flex-1" />
              {rateNote && <span className="faint text-[11.5px]">{rateNote}</span>}
              <Link href="/transactions" className="linkish">See all</Link>
            </div>
            <FilterBar storageKey="omh-tx-view">
              <span className="chip">Search transactions…</span>
              <span className="chip">Category</span>
              <span className="chip">Account</span>
              <span className="chip">Currency: {currency}</span>
            </FilterBar>
            {!txns ? <Skeleton className="h-40" /> : shownTx.length === 0 ? (
              <EmptyState icon={<ArrowLeftRight size={18} />} title="No transactions yet" body="Payments you add will be listed here, with their real dates and amounts." />
            ) : (
              <div className="table-scroll"><table className="data-table">
                <thead><tr><th>Date / ID</th><th>Description</th><th>Category</th><th className="r">Amount</th><th>Status</th></tr></thead>
                <tbody>
                  {shownTx.map((t) => {
                    const dir = t.kind === "income" ? "in" : "out";
                    const st = t.status === "pending" ? "warn" : t.status === "failed" || t.status === "reversed" ? "err" : "ok";
                    return (
                      <tr key={t.id}>
                        <td><span className="num">{niceDate(t.date)}</span> <span className="faint num text-[11.5px]">{t.id.slice(0, 8)}</span></td>
                        <td><b className="font-semibold">{t.description}</b> {t.payee && <span className="muted">· {t.payee}</span>}</td>
                        <td>{t.category ? <span className="lbl"><i style={{ background: "var(--c1)" }} />{t.category}</span> : "—"}</td>
                        <td className={`r num font-bold ${dir === "in" ? "credit-v" : "debit-v"}`}>{dir === "in" ? "+" : "−"}{fmt(t.amount)}</td>
                        <td><span className={`pill ${st}`}>{t.status}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table></div>
            )}
          </div>
        </>
      )}

      <Modal open={add === "account"} onClose={() => setAdd(null)} title="New account">
        <AccountForm onDone={() => setAdd(null)} />
      </Modal>
      <Modal open={add === "txn"} onClose={() => setAdd(null)} title="New payment" wide>
        <TxnForm onDone={() => setAdd(null)} />
      </Modal>
      <Modal open={add === "sub"} onClose={() => setAdd(null)} title="New subscription" wide>
        <SubForm onDone={() => setAdd(null)} />
      </Modal>
    </>
  );
}
