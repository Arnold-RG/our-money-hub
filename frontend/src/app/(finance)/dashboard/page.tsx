"use client";

import Link from "next/link";
import { useState } from "react";
import { motion } from "motion/react";
import { AlertTriangle, ArrowDownRight, ArrowLeftRight, ArrowUpRight, Bot, CalendarClock, Gauge, Info, Landmark, Plus, Repeat, Sparkles, Wallet } from "lucide-react";
import type { BudgetView, Forecast, Rate, Signal, Summary, Txn } from "@/lib/api";
import { useWs } from "@/lib/hooks";
import { useApp } from "@/providers/app-provider";
import { fmt, formatAmount, pct, type Money } from "@/lib/money";
import { niceDate } from "@/lib/labels";
import { Badge, Button, Card, EmptyState, Modal, SectionTitle, Skeleton, cx } from "@/components/ui";
import { CountUp } from "@/components/finance/count-up";
import { PulseChart, Ring } from "@/components/charts";
import { CurrencyLens } from "@/components/layout/shell";
import { AccountForm, SubForm, TxnForm } from "@/components/finance/forms";

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? "Good night" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

function Metric({ label, value, icon, tone, hint, delay = 0 }: { label: string; value: Money | null | undefined; icon: React.ReactNode; tone?: "pos" | "neg"; hint?: string; delay?: number }) {
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay, duration: 0.4 }} className="card p-4 sm:p-5">
      <div className="flex items-center justify-between text-xs font-medium text-muted">
        {label}
        <span className="grid size-8 place-items-center rounded-xl bg-surface-3 text-accent">{icon}</span>
      </div>
      <div className={cx("tnum mt-3 text-[22px] font-semibold tracking-tight sm:text-2xl", tone === "neg" && "text-accent-2", tone === "pos" && "text-positive")}>{value ? fmt(value, { sign: tone !== undefined }) : "—"}</div>
      {hint && <div className="mt-1 text-xs text-faint">{hint}</div>}
    </motion.div>
  );
}

function SignalRow({ s }: { s: Signal }) {
  const Icon = s.type.includes("rate") ? Landmark : s.type.includes("renewal") ? CalendarClock : s.type.includes("budget") ? Gauge : s.type.includes("duplicate") ? Repeat : Info;
  return (
    <li className="flex gap-3 rounded-2xl border border-line bg-surface-2/60 p-3.5">
      <span className={cx("grid size-9 shrink-0 place-items-center rounded-xl", s.severity === "danger" ? "bg-danger/15 text-danger" : s.severity === "warning" ? "bg-warning/15 text-warning" : "bg-info/15 text-info")}>
        <Icon size={16} />
      </span>
      <div className="min-w-0">
        <p className="text-sm font-medium">{s.title}</p>
        <p className="mt-0.5 text-xs text-muted">{s.detail}</p>
      </div>
    </li>
  );
}

function RatesCard() {
  const { data: rates } = useWs<Rate[]>("/exchange-rates");
  const pick = (b: string, q: string) => rates?.filter((r) => r.base === b && r.quote === q).sort((a, z) => (a.provider === "manual" ? -1 : 0) - (z.provider === "manual" ? -1 : 0) || z.effective_date.localeCompare(a.effective_date))[0];
  const rows = [pick("EUR", "PLN"), pick("USD", "PLN"), pick("RWF", "PLN") ?? pick("PLN", "RWF"), pick("USD", "RWF")].filter(Boolean) as Rate[];
  return (
    <Card>
      <SectionTitle title="Official exchange rates" hint="Mid rates as published, never guessed" action={<Link href="/settings#rates" className="hit inline-flex items-center text-xs font-medium text-accent">Sources</Link>} />
      {!rates ? (
        <Skeleton className="h-28" />
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted">No rates on file yet. Sync NBP, ECB and BNR from Settings.</p>
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center justify-between py-2.5 text-sm">
              <span className="font-medium">
                1 {r.base} <span className="text-faint">→</span> {r.quote}
              </span>
              <span className="text-right">
                <span className="tnum block font-semibold">{r.rate.replace(/0+$/, "").replace(/\.$/, "")}</span>
                <span className="block text-xs text-faint">
                  {r.provider.toUpperCase()} · {niceDate(r.effective_date)}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Onboarding({ onAdd }: { onAdd: (k: "account" | "txn" | "sub") => void }) {
  const steps = [
    { k: "account" as const, icon: Wallet, t: "Add an account", d: "Bank, card, cash, MTN MoMo or Airtel Money, ikimina, IKE/IKZE. Any of PLN, RWF, EUR, USD." },
    { k: "txn" as const, icon: ArrowLeftRight, t: "Record a payment", d: "Income, expense or a transfer between currencies. Or import a CSV from your bank." },
    { k: "sub" as const, icon: Repeat, t: "Track a subscription", d: "AI tools, hosting, domains and client plans. Renewals and duplicates surface here." },
  ];
  return (
    <div className="grid gap-3 md:grid-cols-3">
      {steps.map(({ k, icon: Icon, t, d }, i) => (
        <motion.button key={k} onClick={() => onAdd(k)} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 + i * 0.07 }} className="card group flex flex-col items-start p-5 text-left transition hover:border-line-strong">
          <span className="flex w-full items-center justify-between">
            <span className="grid size-10 place-items-center rounded-2xl bg-accent/12 text-accent">
              <Icon size={18} />
            </span>
            <span className="text-xs font-semibold text-faint">STEP {i + 1}</span>
          </span>
          <span className="mt-4 text-[15px] font-semibold">{t}</span>
          <span className="mt-1 text-sm text-muted">{d}</span>
          <span className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-accent">
            <Plus size={15} /> Start
          </span>
        </motion.button>
      ))}
    </div>
  );
}

export default function Dashboard() {
  const { me, workspace, currency } = useApp();
  const { data: s, error } = useWs<Summary>("/reports/summary", true);
  const { data: fc } = useWs<Forecast>("/reports/forecast?days=90", true);
  const { data: signals } = useWs<Signal[]>("/reports/signals", true);
  const { data: txns } = useWs<Txn[]>("/transactions?limit=6");
  const [add, setAdd] = useState<null | "account" | "txn" | "sub">(null);
  const first = me?.display_name?.split(" ")[0];

  const ratesCaption = s && Object.keys(s.rates_used).length > 0
    ? Object.entries(s.rates_used).map(([k, v]) => `${k} ${v.source}${v.effective_date ? " " + niceDate(v.effective_date) : ""}`).join(" · ")
    : null;

  return (
    <div className="flex flex-col gap-6">
      {/* Money Pulse hero */}
      <section className="card relative overflow-hidden p-5 sm:p-8">
        <div className="aurora" aria-hidden />
        <div className="grid-bg absolute inset-0" aria-hidden />
        <div className="relative">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">Money Pulse · {workspace?.name}</p>
              <h1 className="display mt-1 text-[26px] sm:text-[32px]">
                {greeting()}
                {first ? `, ${first}` : ""}.
              </h1>
            </div>
            <div className="sm:hidden">
              <CurrencyLens compact />
            </div>
          </div>
          {!s && !error ? (
            <div className="mt-6 space-y-3">
              <Skeleton className="h-12 w-64" />
              <Skeleton className="h-44" />
            </div>
          ) : s && s.total_balance ? (
            <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] lg:items-end">
              <div>
                <p className="text-sm text-muted">Total balance in {currency}</p>
                <CountUp value={s.total_balance} className="tnum display mt-1 block text-[44px] leading-none sm:text-[56px]" />
                <div className="mt-4 flex flex-wrap gap-2">
                  <Badge tone={s.net_cash_flow.minor >= 0 ? "positive" : "warning"}>
                    {s.net_cash_flow.minor >= 0 ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
                    {formatAmount(s.net_cash_flow.amount, s.currency, { sign: true })} this month
                  </Badge>
                  {s.pending_balance && s.pending_balance.minor !== 0 && <Badge tone="info">{fmt(s.pending_balance)} pending</Badge>}
                  {s.unconverted.length > 0 && (
                    <Badge tone="warning">
                      <AlertTriangle size={12} /> {s.unconverted.join(", ")} not converted
                    </Badge>
                  )}
                </div>
                {fc?.status === "ok" && fc.end && (
                  <p className="mt-4 max-w-sm text-sm text-muted">
                    In 90 days, about <span className="tnum font-semibold text-ink">{fmt(fc.end)}</span>
                    {fc.lowest && fc.lowest.balance.minor < (fc.start?.minor ?? 0) && (
                      <>
                        , lowest <span className="tnum font-semibold text-ink">{fmt(fc.lowest.balance)}</span> on {niceDate(fc.lowest.date)}
                      </>
                    )}
                    . <span className="text-faint">Forecast, not a confirmed figure.</span>
                  </p>
                )}
              </div>
              <div>
                {fc?.status === "ok" && fc.points.length > 1 ? (
                  <PulseChart points={fc.points} events={fc.events} />
                ) : (
                  <div className="grid h-[220px] place-items-center rounded-2xl border border-dashed border-line-strong text-sm text-muted">The 90-day pulse appears once there is activity.</div>
                )}
              </div>
            </div>
          ) : (
            <div className="mt-5">
              <p className="max-w-xl text-[15px] text-muted">
                Your hub is empty and honest: nothing here is invented. Add your first account and the Money Pulse comes alive with a balance, a 90-day forecast and renewal markers.
              </p>
            </div>
          )}
          {ratesCaption && <p className="relative mt-4 text-xs text-faint">Converted at {ratesCaption}</p>}
        </div>
      </section>

      {s && !s.has_data && <Onboarding onAdd={setAdd} />}

      {s?.has_data && (
        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Metric label="Income this month" value={s.monthly_revenue} icon={<ArrowUpRight size={15} />} delay={0.02} />
          <Metric label="Spent this month" value={s.monthly_expenses} icon={<ArrowDownRight size={15} />} delay={0.06} />
          <Metric label="Subscriptions / month" value={s.subscriptions_monthly} icon={<Repeat size={15} />} hint={`${fmt(s.subscriptions_annual)} a year`} delay={0.1} />
          <Metric label="AI operating cost" value={s.ai_operating_cost} icon={<Bot size={15} />} hint="Plans + usage this month" delay={0.14} />
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-6">
          <Card>
            <SectionTitle title="Hub signals" hint="What needs a look, worked out from your own records" />
            {!signals ? (
              <Skeleton className="h-24" />
            ) : signals.length === 0 ? (
              <div className="flex items-center gap-3 rounded-2xl border border-line bg-surface-2/60 p-4 text-sm text-muted">
                <Sparkles size={18} className="text-accent" /> All quiet. Renewals, duplicate subscriptions, budget limits and missing rates show up here.
              </div>
            ) : (
              <ul className="flex flex-col gap-2.5">{signals.slice(0, 6).map((x, i) => <SignalRow key={x.type + i} s={x} />)}</ul>
            )}
          </Card>
          <Card>
            <SectionTitle title="Recent activity" action={<Link href="/transactions" className="hit inline-flex items-center text-xs font-medium text-accent">See all</Link>} />
            {!txns ? (
              <Skeleton className="h-32" />
            ) : txns.length === 0 ? (
              <EmptyState icon={<ArrowLeftRight size={20} />} title="No payments yet" body="Payments you record or import appear here, newest first." action={<Button onClick={() => setAdd("txn")} icon={<Plus size={15} />}>Add payment</Button>} />
            ) : (
              <ul className="divide-y divide-line">
                {txns.slice(0, 6).map((t) => (
                  <li key={t.id} className="flex items-center gap-3 py-3">
                    <span className={cx("grid size-9 shrink-0 place-items-center rounded-xl", t.kind === "income" ? "bg-positive/15 text-positive" : t.kind === "expense" ? "bg-accent-2/15 text-accent-2" : "bg-info/15 text-info")}>
                      {t.kind === "income" ? <ArrowUpRight size={16} /> : t.kind === "expense" ? <ArrowDownRight size={16} /> : <ArrowLeftRight size={16} />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{t.description}</p>
                      <p className="truncate text-xs text-faint">
                        {niceDate(t.date)} · {t.account}
                        {t.category ? ` · ${t.category}` : ""}
                        {t.status === "pending" ? " · pending" : ""}
                      </p>
                    </div>
                    <span className={cx("tnum text-sm font-semibold", t.kind === "income" && "text-positive")}>{fmt(t.amount, { sign: t.kind === "income" })}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        <div className="flex flex-col gap-6">
          {s?.has_data && (
            <Card>
              <SectionTitle title="Budgets this month" action={<Link href="/budgets" className="hit inline-flex items-center text-xs font-medium text-accent">Manage</Link>} />
              {s.budgets.length === 0 ? (
                <p className="text-sm text-muted">No budgets yet. Set one for a category, or guard your AI spend.</p>
              ) : (
                <ul className="flex flex-col gap-4">
                  {s.budgets.slice(0, 4).map((b: BudgetView) => {
                    const u = Number(b.committed_utilization);
                    return (
                      <li key={b.id} className="flex items-center gap-3">
                        <Ring value={u} size={48} stroke={5} tone={b.state === "exceeded" ? "danger" : b.state === "warning" ? "warning" : "accent"}>
                          {pct(b.committed_utilization)}
                        </Ring>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{b.name}</p>
                          <p className="tnum text-xs text-faint">
                            {fmt(b.available)} left of {fmt(b.allocated)}
                          </p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          )}
          {s?.has_data && s.accounts.length > 0 && (
            <Card>
              <SectionTitle title="Accounts" action={<Link href="/accounts" className="hit inline-flex items-center text-xs font-medium text-accent">All</Link>} />
              <ul className="flex flex-col gap-2">
                {s.accounts.slice(0, 5).map((a) => (
                  <li key={a.account_id} className="flex items-center justify-between rounded-xl px-1 py-1.5 text-sm">
                    <span className="truncate font-medium">{a.name}</span>
                    <span className="tnum text-right">
                      <span className="block font-semibold">{fmt(a.balance)}</span>
                      {a.converted && a.currency !== currency && <span className="block text-xs text-faint">≈ {fmt(a.converted)}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <RatesCard />
        </div>
      </div>

      <Modal open={add === "account"} onClose={() => setAdd(null)} title="New account">
        <AccountForm onDone={() => setAdd(null)} />
      </Modal>
      <Modal open={add === "txn"} onClose={() => setAdd(null)} title="New payment" wide>
        <TxnForm onDone={() => setAdd(null)} />
      </Modal>
      <Modal open={add === "sub"} onClose={() => setAdd(null)} title="New subscription" wide>
        <SubForm onDone={() => setAdd(null)} />
      </Modal>
    </div>
  );
}
