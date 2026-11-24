"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AlertTriangle, CalendarClock, Check, Pause, Play, Plus, Repeat, X } from "lucide-react";
import { api, type Sub, type Summary } from "@/lib/api";
import { useWs } from "@/lib/hooks";
import { refreshAll } from "@/providers/app-provider";
import { fmt } from "@/lib/money";
import { INTERVALS, SUB_KINDS, daysFromToday, niceDate } from "@/lib/labels";
import { Badge, Button, Card, EmptyState, ErrorNote, Modal, SectionTitle, Skeleton, cx } from "@/components/ui";
import { PageHeader } from "@/components/finance/page-header";
import { SubForm } from "@/components/finance/forms";

const kindLabel = (k: string) => SUB_KINDS.find((x) => x.value === k)?.label ?? k;
const intervalLabel = (k: string) => INTERVALS.find((x) => x.value === k)?.label.toLowerCase() ?? k;

function Radar({ subs }: { subs: Sub[] }) {
  const soon = subs.filter((s) => s.next_renewal && s.status !== "cancelled" && daysFromToday(s.next_renewal) >= 0 && daysFromToday(s.next_renewal) <= 30);
  return (
    <Card>
      <SectionTitle title="Renewal radar" hint="The next 30 days" />
      <div className="relative h-16">
        <div className="absolute inset-x-0 top-8 h-px bg-line-strong" />
        {[0, 7, 14, 21, 30].map((d) => (
          <span key={d} className="absolute top-10 -translate-x-1/2 text-xs text-faint" style={{ left: `${(d / 30) * 100}%` }}>
            {d === 0 ? "today" : `+${d}d`}
          </span>
        ))}
        {soon.map((s) => {
          const d = daysFromToday(s.next_renewal!);
          return (
            <span key={s.id} title={`${s.name} · ${niceDate(s.next_renewal)}`} className={cx("absolute top-8 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full ring-4 ring-surface", s.direction === "incoming" ? "bg-positive" : s.status === "trial" ? "bg-warning" : "bg-accent-2")} style={{ left: `${(d / 30) * 100}%` }} />
          );
        })}
      </div>
      {soon.length === 0 ? (
        <p className="text-sm text-muted">Nothing renews in the next 30 days.</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-1.5 text-sm">
          {soon
            .sort((a, b) => a.next_renewal!.localeCompare(b.next_renewal!))
            .map((s) => (
              <li key={s.id} className="flex justify-between gap-3">
                <span className="truncate">
                  {niceDate(s.next_renewal)} · {s.name}
                  {s.status === "trial" && <span className="text-warning"> · trial ends</span>}
                </span>
                <span className="tnum font-medium">{fmt(s.amount, { sign: s.direction === "incoming" })}</span>
              </li>
            ))}
        </ul>
      )}
    </Card>
  );
}

function SubsInner() {
  const params = useSearchParams();
  const [open, setOpen] = useState(params.get("new") === "1");
  const [pay, setPay] = useState<Sub | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { data: subs } = useWs<Sub[]>("/subscriptions");
  const { data: s } = useWs<Summary>("/reports/summary", true);
  const outgoing = subs?.filter((x) => x.direction === "outgoing" && x.status !== "cancelled") ?? [];
  const incoming = subs?.filter((x) => x.direction === "incoming" && x.status !== "cancelled") ?? [];
  const cancelled = subs?.filter((x) => x.status === "cancelled") ?? [];
  const setStatus = async (x: Sub, status: string) => {
    await api(`/subscriptions/${x.id}`, { method: "PATCH", json: { status } });
    refreshAll();
  };

  const row = (x: Sub) => (
    <li key={x.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-surface-3 text-sm font-semibold">{x.vendor[0]?.toUpperCase()}</span>
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
            {x.name}
            {x.possible_duplicate && <Badge tone="warning"><AlertTriangle size={11} /> possible duplicate</Badge>}
            {x.status === "trial" && <Badge tone="warning">trial</Badge>}
            {x.status === "paused" && <Badge>paused</Badge>}
          </p>
          <p className="truncate text-xs text-faint">
            {kindLabel(x.kind)} · {x.vendor}
            {x.project ? ` · ${x.project}` : ""} · {x.next_renewal ? `renews ${niceDate(x.next_renewal)}` : "no renewal date"}
          </p>
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 sm:justify-end">
        <div className="text-right">
          <p className="tnum text-sm font-semibold">
            {fmt(x.amount)} <span className="font-normal text-faint">/ {intervalLabel(x.interval).replace("ly", "").replace("dai", "day")}</span>
          </p>
          {x.interval !== "monthly" && <p className="tnum text-xs text-faint">{fmt(x.monthly)} a month</p>}
        </div>
        <div className="flex gap-1">
          {x.status !== "cancelled" && x.next_renewal && (
            <Button size="sm" variant="secondary" onClick={() => setPay(x)} icon={<Check size={14} />}>
              {x.direction === "incoming" ? "Received" : "Paid"}
            </Button>
          )}
          {x.status === "active" && (
            <button className="hit grid place-items-center rounded-full text-faint hover:bg-surface-3 hover:text-ink" aria-label={`Pause ${x.name}`} onClick={() => setStatus(x, "paused")}>
              <Pause size={15} />
            </button>
          )}
          {x.status === "paused" && (
            <button className="hit grid place-items-center rounded-full text-faint hover:bg-surface-3 hover:text-ink" aria-label={`Resume ${x.name}`} onClick={() => setStatus(x, "active")}>
              <Play size={15} />
            </button>
          )}
          {x.status !== "cancelled" && (
            <button className="hit grid place-items-center rounded-full text-faint hover:bg-surface-3 hover:text-danger" aria-label={`Cancel ${x.name}`} onClick={() => confirm(`Mark ${x.name} as cancelled?`) && setStatus(x, "cancelled")}>
              <X size={15} />
            </button>
          )}
        </div>
      </div>
    </li>
  );

  return (
    <>
      <PageHeader eyebrow="Subscriptions" title="What renews, and what it really costs" subtitle="Yearly and quarterly plans are turned into exact monthly amounts. Client plans count as recurring revenue." actions={<Button onClick={() => setOpen(true)} icon={<Plus size={16} />}>Add subscription</Button>} />
      {s && subs && subs.length > 0 && (
        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            { l: "Outgoing / month", v: s.subscriptions_monthly },
            { l: "Outgoing / year", v: s.subscriptions_annual },
            { l: "AI & API plans / month", v: s.ai_subscriptions_monthly },
            { l: "Client recurring revenue", v: s.client_mrr, h: `${fmt(s.client_arr)} a year` },
          ].map((m) => (
            <Card key={m.l} className="p-4 sm:p-5">
              <p className="text-xs font-medium text-muted">{m.l}</p>
              <p className="tnum mt-2 text-xl font-semibold">{fmt(m.v)}</p>
              {m.h && <p className="text-xs text-faint">{m.h}</p>}
            </Card>
          ))}
        </div>
      )}
      {!subs ? (
        <Skeleton className="h-48" />
      ) : subs.length === 0 ? (
        <EmptyState icon={<Repeat size={20} />} title="No subscriptions yet" body="Add AI tools, API plans, hosting, domains and software, plus client plans you bill. Renewals and possible duplicates show up automatically." action={<Button onClick={() => setOpen(true)} icon={<Plus size={16} />}>Add a subscription</Button>} />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <div className="flex flex-col gap-6">
            {outgoing.length > 0 && (
              <Card>
                <SectionTitle title="You pay" />
                <ul className="divide-y divide-line">{outgoing.map(row)}</ul>
              </Card>
            )}
            {incoming.length > 0 && (
              <Card>
                <SectionTitle title="Clients pay you" />
                <ul className="divide-y divide-line">{incoming.map(row)}</ul>
              </Card>
            )}
            {cancelled.length > 0 && (
              <Card>
                <SectionTitle title="Cancelled" />
                <ul className="divide-y divide-line opacity-70">{cancelled.map(row)}</ul>
              </Card>
            )}
          </div>
          <div className="flex flex-col gap-6">
            <Radar subs={subs} />
            <Card>
              <SectionTitle title="How payments work" />
              <p className="flex gap-2 text-sm text-muted">
                <CalendarClock size={16} className="mt-0.5 shrink-0 text-accent" /> “Paid” posts the charge to the linked account for that renewal date and moves the next renewal forward, keeping month-end dates anchored. The same renewal can’t be recorded twice.
              </p>
            </Card>
          </div>
        </div>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="New subscription" wide>
        <SubForm onDone={() => setOpen(false)} />
      </Modal>
      <Modal open={!!pay} onClose={() => { setPay(null); setError(null); }} title={pay?.direction === "incoming" ? "Record client payment" : "Record payment"}>
        {pay && (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted">
              {pay.name}: <span className="tnum font-semibold text-ink">{fmt(pay.amount)}</span> for the renewal on {niceDate(pay.next_renewal, { day: "numeric", month: "long", year: "numeric" })}.
              {!pay.account_id && " This subscription has no account linked yet, so it can't be posted."}
            </p>
            <ErrorNote error={error} />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setPay(null)}>Cancel</Button>
              <Button
                disabled={!pay.account_id}
                onClick={async () => {
                  try {
                    await api(`/subscriptions/${pay.id}/record-payment`, { method: "POST", json: { renewal: pay.next_renewal } });
                    await refreshAll();
                    setPay(null);
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                Record
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}

export default function SubscriptionsPage() {
  return (
    <Suspense>
      <SubsInner />
    </Suspense>
  );
}
