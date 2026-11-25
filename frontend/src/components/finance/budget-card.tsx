"use client";

import { Bot, Lock } from "lucide-react";
import type { BudgetView } from "@/lib/api";
import { fmt } from "@/lib/money";
import { providerLabel } from "@/lib/labels";
import { Badge, Card, Progress, cx } from "@/components/ui";

export function BudgetCard({ b }: { b: BudgetView }) {
  const spend = b.actual_spend ?? b.actual;
  const over = Boolean(b.over_budget) || b.state === "exceeded";
  const budgetMinor = b.allocated.minor || 1;
  const spendPct = Math.min(999, Math.round((spend.minor / budgetMinor) * 100));
  const reservedPct = Math.min(100, Math.round((b.reserved.minor / budgetMinor) * 100));
  const tone = over ? "danger" : b.state === "warning" ? "warning" : "accent";

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-semibold">{b.name}</p>
        {b.scope === "ai" && <Badge tone="accent"><Bot size={11} /> {providerLabel(b.ai_provider)}</Badge>}
        {b.hard_limit && <Badge><Lock size={11} /> Hard limit</Badge>}
      </div>

      {over && (
        <p className="mt-3 rounded-xl border px-3 py-2 text-sm text-danger" role="alert" style={{ borderColor: "var(--danger, #b42318)" }}>
          Over budget this month. Actual spend {fmt(spend)} is past the {fmt(b.allocated)} limit.
        </p>
      )}

      <section className="mt-4">
        <p className="text-xs font-medium uppercase tracking-wide text-faint">Budget vs actual</p>
        <dl className="tnum mt-2 grid grid-cols-2 gap-2 text-sm">
          <div>
            <dt className="text-faint">Budget</dt>
            <dd className="text-lg font-semibold">{fmt(b.allocated)}</dd>
          </div>
          <div>
            <dt className="text-faint">Actual spend</dt>
            <dd className="text-lg font-semibold">{fmt(spend)}</dd>
          </div>
        </dl>
        <div className="mt-2">
          <Progress value={Math.min(100, spendPct)} tone={tone} label={`${b.name} actual spend versus budget`} />
        </div>
        <p className="mt-1 text-xs text-faint">{spendPct}% of the budget spent. Reserved funds are shown separately below.</p>
      </section>

      <section className="mt-4 border-t border-line pt-3">
        <p className="text-xs font-medium uppercase tracking-wide text-faint">Commitments</p>
        <dl className="tnum mt-2 grid grid-cols-2 gap-2 text-sm">
          <div>
            <dt className="text-faint">Reserved</dt>
            <dd className="font-medium">{fmt(b.reserved)}</dd>
          </div>
          <div>
            <dt className="text-faint">Available</dt>
            <dd className="font-medium">{fmt(b.available)}</dd>
          </div>
        </dl>
        <div className="mt-2">
          <Progress value={reservedPct} tone="accent" label={`${b.name} reserved versus budget`} />
        </div>
      </section>

      {Object.keys(b.unconverted).length > 0 && (
        <p className="mt-3 text-xs text-warning">Some {Object.keys(b.unconverted).join(", ")} spend has no current rate and is not counted. AI reservations stay blocked until a rate is on file.</p>
      )}
      <p className={cx("mt-3 text-xs", over ? "text-danger" : b.state === "warning" ? "text-warning" : "text-faint")}>
        {over ? "Over the limit this month." : b.state === "warning" ? `Past the ${b.alert_threshold_pct}% alert.` : `Alert at ${b.alert_threshold_pct}%.`} Period {b.period}.
      </p>
    </Card>
  );
}
