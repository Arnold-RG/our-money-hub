"use client";

import { useState } from "react";
import { Bot, Cpu, KeyRound, Lock, Plus, ShieldCheck, X } from "lucide-react";
import { api, type BudgetView, type Reservation, type Summary, type Usage } from "@/lib/api";
import { useWs } from "@/lib/hooks";
import { refreshAll } from "@/providers/app-provider";
import { fmt } from "@/lib/money";
import { niceDate, providerLabel } from "@/lib/labels";
import { Badge, Button, Card, EmptyState, Modal, SectionTitle, Skeleton } from "@/components/ui";
import { PageHeader } from "@/components/finance/page-header";
import { BudgetCard } from "@/components/finance/budget-card";
import { BudgetForm, ReserveForm, UsageForm } from "@/components/finance/forms";

export default function AiPage() {
  const { data: s } = useWs<Summary>("/reports/summary", true);
  const { data: budgets } = useWs<BudgetView[]>("/budgets");
  const { data: res } = useWs<Reservation[]>("/budget-reservations");
  const { data: usage } = useWs<Usage[]>("/ai-usage");
  const [open, setOpen] = useState<null | "budget" | "usage" | "reserve">(null);
  const ai = budgets?.filter((b) => b.scope === "ai") ?? [];
  const activeRes = res?.filter((r) => r.status === "active") ?? [];
  const tokens = usage?.reduce((n, u) => n + u.input_tokens + u.output_tokens, 0) ?? 0;

  return (
    <>
      <PageHeader
        eyebrow="AI spend"
        title="Agents spend only what you allow"
        subtitle="Every run reserves budget first, then settles at the real cost. No budget, no rate, or not enough left: the run is refused."
        actions={
          <>
            <Button variant="secondary" onClick={() => setOpen("usage")} icon={<Cpu size={16} />}>Record usage</Button>
            <Button onClick={() => setOpen(ai.length ? "reserve" : "budget")} icon={<Plus size={16} />}>{ai.length ? "Reserve" : "AI budget"}</Button>
          </>
        }
      />
      {s && (
        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            { l: "AI operating cost / month", v: fmt(s.ai_operating_cost), h: "Plans + metered usage" },
            { l: "Metered usage this month", v: fmt(s.ai_usage_month) },
            { l: "AI & API plans / month", v: fmt(s.ai_subscriptions_monthly) },
            { l: "Tokens recorded", v: tokens.toLocaleString("en-GB"), h: `${usage?.length ?? 0} records` },
          ].map((m) => (
            <Card key={m.l} className="p-4 sm:p-5">
              <p className="text-xs font-medium text-muted">{m.l}</p>
              <p className="tnum mt-2 text-xl font-semibold">{m.v}</p>
              {m.h && <p className="text-xs text-faint">{m.h}</p>}
            </Card>
          ))}
        </div>
      )}

      {!budgets ? (
        <Skeleton className="h-40" />
      ) : ai.length === 0 ? (
        <EmptyState icon={<Bot size={20} />} title="No AI spend guard yet" body="Create a monthly AI budget, for one provider or all of them. Agents connected through the Arnova ecosystem must reserve against it before every run." action={<Button onClick={() => setOpen("budget")} icon={<Plus size={16} />}>Create AI budget</Button>} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{ai.map((b) => <BudgetCard key={b.id} b={b} />)}</div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <SectionTitle title="Open reservations" hint="Held from the budget until settled or released" />
          {!res ? (
            <Skeleton className="h-24" />
          ) : activeRes.length === 0 ? (
            <p className="text-sm text-muted">No runs are holding budget right now.</p>
          ) : (
            <ul className="divide-y divide-line">
              {activeRes.map((r) => (
                <li key={r.id} className="flex items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{r.purpose}</p>
                    <p className="text-xs text-faint">
                      {r.agent_id ?? "manual"} · {niceDate(r.created_at.slice(0, 10))}
                    </p>
                  </div>
                  <span className="tnum text-sm font-semibold">{fmt(r.amount)}</span>
                  <button
                    className="hit grid place-items-center rounded-full text-faint hover:bg-surface-3 hover:text-ink"
                    aria-label={`Release ${r.purpose}`}
                    onClick={async () => {
                      await api(`/budget-reservations/${r.id}/release`, { method: "POST" });
                      refreshAll();
                    }}
                  >
                    <X size={15} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <SectionTitle title="Usage" hint="Manual records, settled reservations and RAGI events" />
          {!usage ? (
            <Skeleton className="h-24" />
          ) : usage.length === 0 ? (
            <p className="text-sm text-muted">No AI usage recorded yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {usage.slice(0, 12).map((u) => (
                <li key={u.id} className="flex items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {providerLabel(u.provider)}
                      {u.model ? ` · ${u.model}` : ""}
                    </p>
                    <p className="text-xs text-faint">
                      {niceDate(u.date)} · {u.agent_id ?? "no agent"} · {(u.input_tokens + u.output_tokens).toLocaleString("en-GB")} tokens
                    </p>
                  </div>
                  <Badge>{u.source}</Badge>
                  <span className="tnum text-sm font-semibold">{fmt(u.cost)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="mt-6">
        <SectionTitle title="How agents connect" />
        <ul className="grid gap-4 text-sm text-muted md:grid-cols-3">
          <li className="flex gap-3">
            <KeyRound size={18} className="mt-0.5 shrink-0 text-accent" />
            <span>Each service signs its requests with its own rotating key. No shared password, and keys never live in code.</span>
          </li>
          <li className="flex gap-3">
            <Lock size={18} className="mt-0.5 shrink-0 text-accent" />
            <span>Service reservations are always held to the limit, checked and reserved inside one locked transaction.</span>
          </li>
          <li className="flex gap-3">
            <ShieldCheck size={18} className="mt-0.5 shrink-0 text-accent" />
            <span>A retried run never reserves twice, and an estimate in another currency needs a current official rate.</span>
          </li>
        </ul>
      </Card>

      <Modal open={open === "budget"} onClose={() => setOpen(null)} title="New AI spend guard">
        <BudgetForm scope="ai" onDone={() => setOpen(null)} />
      </Modal>
      <Modal open={open === "usage"} onClose={() => setOpen(null)} title="Record AI usage" wide>
        <UsageForm onDone={() => setOpen(null)} />
      </Modal>
      <Modal open={open === "reserve"} onClose={() => setOpen(null)} title="Reserve AI budget">
        <ReserveForm budgets={budgets ?? []} onDone={() => setOpen(null)} />
      </Modal>
    </>
  );
}
