"use client";

import { useState } from "react";
import { ChartNoAxesCombined, ExternalLink, PiggyBank } from "lucide-react";
import { useWs } from "@/lib/hooks";
import { useApp } from "@/providers/app-provider";
import { fmt, pct, type Currency, type Money } from "@/lib/money";
import { niceDate } from "@/lib/labels";
import { Badge, Card, EmptyState, Progress, SectionTitle, Segmented, Skeleton } from "@/components/ui";
import { PageHeader } from "@/components/finance/page-header";
import { CashflowChart, Donut, donutColor } from "@/components/charts";

interface Cashflow { currency: Currency; series: { month: string; income: Money; expense: Money; net: Money }[]; unconverted: string[] }
interface Cats {
  currency: Currency; month: string; income: Money; expense: Money; unconverted: string[];
  categories: { category_id: string; name: string; bucket: string | null; amount: Money }[];
  overlay_50_30_20: Record<"needs" | "wants" | "savings", { actual: Money; share: string; guide: string }> | null;
}
interface Retire { account_id: string; name: string; kind: string; label: string; limit: Money; contributed: Money; remaining: Money; source: string }

export default function ReportsPage() {
  const { currency } = useApp();
  const [months, setMonths] = useState<"3" | "6" | "12">("6");
  const { data: cf } = useWs<Cashflow>(`/reports/cashflow?months=${months}`, true);
  const { data: cats } = useWs<Cats>("/reports/categories", true);
  const { data: ret } = useWs<Retire[]>("/reports/retirement-limits");
  const empty = cf && cf.series.every((s) => s.income.minor === 0 && s.expense.minor === 0);

  return (
    <>
      <PageHeader eyebrow="Reports" title="See the shape of your money" subtitle={`Everything in ${currency} at dated official rates. Amounts without a rate are listed, not estimated.`} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Card>
          <SectionTitle title="Cash flow" hint="Confirmed income and spending per month" action={<Segmented size="sm" label="Months" value={months} onChange={setMonths} options={[{ value: "3", label: "3M" }, { value: "6", label: "6M" }, { value: "12", label: "1Y" }]} />} />
          {!cf ? (
            <Skeleton className="h-64" />
          ) : empty ? (
            <EmptyState icon={<ChartNoAxesCombined size={20} />} title="No cash flow yet" body="Confirmed income and expenses appear here month by month." />
          ) : (
            <>
              <CashflowChart series={cf.series} currency={cf.currency} />
              <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted">
                <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-positive" /> Income</span>
                <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-accent-2" /> Spending</span>
                {cf.unconverted.length > 0 && <Badge tone="warning">{cf.unconverted.join(", ")} not converted</Badge>}
              </div>
            </>
          )}
        </Card>
        <Card>
          <SectionTitle title="Where it went" hint={cats ? niceDate(cats.month + "-01", { month: "long", year: "numeric" }) : undefined} />
          {!cats ? (
            <Skeleton className="h-56" />
          ) : cats.categories.length === 0 ? (
            <p className="text-sm text-muted">No categorised spending this month.</p>
          ) : (
            <>
              <Donut
                rows={cats.categories.slice(0, 8)}
                center={
                  <div>
                    <p className="text-xs text-faint">Spent</p>
                    <p className="tnum text-lg font-semibold">{fmt(cats.expense)}</p>
                  </div>
                }
              />
              <ul className="mt-3 flex flex-col gap-1.5 text-sm">
                {cats.categories.slice(0, 8).map((c, i) => (
                  <li key={c.category_id} className="flex items-center gap-2">
                    <span className="size-2.5 rounded-full" style={{ background: donutColor(i) }} />
                    <span className="flex-1 truncate">{c.name}</span>
                    <span className="tnum font-medium">{fmt(c.amount)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <SectionTitle title="50 / 30 / 20 check" hint="Optional guide: needs, wants, savings as a share of this month's income" />
          {!cats ? (
            <Skeleton className="h-32" />
          ) : !cats.overlay_50_30_20 ? (
            <p className="text-sm text-muted">Needs income this month to compare against. Categories carry a needs / wants / savings tag you can change.</p>
          ) : (
            <ul className="flex flex-col gap-4">
              {(["needs", "wants", "savings"] as const).map((k) => {
                const o = cats.overlay_50_30_20![k];
                const share = Number(o.share) * 100;
                const guide = Number(o.guide) * 100;
                return (
                  <li key={k}>
                    <div className="mb-1.5 flex justify-between text-sm">
                      <span className="font-medium capitalize">{k}</span>
                      <span className="tnum text-muted">
                        {fmt(o.actual)} · <span className="font-semibold text-ink">{pct(o.share)}</span> <span className="text-faint">guide {Math.round(guide)}%</span>
                      </span>
                    </div>
                    <Progress value={share} tone={k !== "savings" && share > guide ? "warning" : "accent"} label={`${k} share of income`} />
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
        <Card>
          <SectionTitle title="IKE / IKZE allowance 2026" hint="Official annual limits, from contributions you recorded" />
          {!ret ? (
            <Skeleton className="h-32" />
          ) : ret.length === 0 ? (
            <div className="flex gap-3 text-sm text-muted">
              <PiggyBank size={18} className="mt-0.5 shrink-0 text-accent" />
              Add an IKE or IKZE account to track how much of this year&apos;s tax-advantaged limit is left.
            </div>
          ) : (
            <ul className="flex flex-col gap-4">
              {ret.map((r) => (
                <li key={r.account_id}>
                  <div className="mb-1.5 flex justify-between gap-2 text-sm">
                    <span className="font-medium">{r.name}</span>
                    <span className="tnum text-muted">
                      {fmt(r.contributed)} of {fmt(r.limit)}
                    </span>
                  </div>
                  <Progress value={(r.contributed.minor / r.limit.minor) * 100} label={`${r.label} used`} />
                  <p className="mt-1 flex items-center justify-between text-xs text-faint">
                    <span>{fmt(r.remaining)} left · {r.label}</span>
                    <a href={r.source} target="_blank" rel="noreferrer" className="hit inline-flex items-center gap-1 text-accent">
                      gov.pl <ExternalLink size={11} />
                    </a>
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
