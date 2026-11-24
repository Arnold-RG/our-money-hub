"use client";

import { Bot, Lock } from "lucide-react";
import type { BudgetView } from "@/lib/api";
import { fmt, pct } from "@/lib/money";
import { providerLabel } from "@/lib/labels";
import { Badge, Card, Progress, cx } from "@/components/ui";
import { Ring } from "@/components/charts";

export function BudgetCard({ b }: { b: BudgetView }) {
  const u = Number(b.committed_utilization) * 100;
  const tone = b.state === "exceeded" ? "danger" : b.state === "warning" ? "warning" : "accent";
  return (
    <Card>
      <div className="flex items-start gap-4">
        <Ring value={u / 100} size={64} tone={tone}>
          {pct(b.committed_utilization)}
        </Ring>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold">{b.name}</p>
            {b.scope === "ai" && <Badge tone="accent"><Bot size={11} /> {providerLabel(b.ai_provider)}</Badge>}
            {b.hard_limit && <Badge><Lock size={11} /> Hard limit</Badge>}
          </div>
          <p className="tnum mt-1 text-2xl font-semibold tracking-tight">
            {fmt(b.available)} <span className="text-sm font-normal text-muted">left</span>
          </p>
        </div>
      </div>
      <div className="mt-4">
        <Progress value={u} tone={tone} label={`${b.name} used`} />
      </div>
      <dl className="tnum mt-3 grid grid-cols-3 gap-2 text-xs">
        <div>
          <dt className="text-faint">Limit</dt>
          <dd className="font-medium">{fmt(b.allocated)}</dd>
        </div>
        <div>
          <dt className="text-faint">Spent</dt>
          <dd className="font-medium">{fmt(b.actual)}</dd>
        </div>
        <div>
          <dt className="text-faint">Reserved</dt>
          <dd className="font-medium">{fmt(b.reserved)}</dd>
        </div>
      </dl>
      {Object.keys(b.unconverted).length > 0 && <p className="mt-3 text-xs text-warning">Some {Object.keys(b.unconverted).join(", ")} spend has no current rate and is not counted. AI reservations stay blocked until a rate is on file.</p>}
      <p className={cx("mt-3 text-xs", b.state === "exceeded" ? "text-danger" : b.state === "warning" ? "text-warning" : "text-faint")}>
        {b.state === "exceeded" ? "Over the limit this month." : b.state === "warning" ? `Past the ${b.alert_threshold_pct}% alert.` : `Alert at ${b.alert_threshold_pct}%.`} Period {b.period}.
      </p>
    </Card>
  );
}

