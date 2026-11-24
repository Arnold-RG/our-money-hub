"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Bot, Gauge, Plus } from "lucide-react";
import type { BudgetView } from "@/lib/api";
import { useWs } from "@/lib/hooks";
import { Button, EmptyState, Modal, SectionTitle, Skeleton } from "@/components/ui";
import { PageHeader } from "@/components/finance/page-header";
import { BudgetForm } from "@/components/finance/forms";
import { BudgetCard } from "@/components/finance/budget-card";

function BudgetsInner() {
  const params = useSearchParams();
  const [open, setOpen] = useState<null | "category" | "ai">(params.get("new") === "1" ? "category" : null);
  const { data: budgets } = useWs<BudgetView[]>("/budgets");
  const cat = budgets?.filter((b) => b.scope === "category") ?? [];
  const ai = budgets?.filter((b) => b.scope === "ai") ?? [];
  return (
    <>
      <PageHeader
        eyebrow="Budgets"
        title="Plan the month, guard the agents"
        subtitle="Available = limit − spent − reserved. AI budgets are what every agent must ask before it runs."
        actions={
          <>
            <Button variant="secondary" onClick={() => setOpen("ai")} icon={<Bot size={16} />}>AI spend guard</Button>
            <Button onClick={() => setOpen("category")} icon={<Plus size={16} />}>New budget</Button>
          </>
        }
      />
      {!budgets ? (
        <Skeleton className="h-48" />
      ) : budgets.length === 0 ? (
        <EmptyState icon={<Gauge size={20} />} title="No budgets yet" body="Set a monthly limit for a category like groceries or software, or an AI spend guard that agents must reserve against before they run." action={<Button onClick={() => setOpen("category")} icon={<Plus size={16} />}>Create a budget</Button>} />
      ) : (
        <div className="flex flex-col gap-8">
          {cat.length > 0 && (
            <section>
              <SectionTitle title="Spending" hint="Confirmed expenses in each category this month" />
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{cat.map((b) => <BudgetCard key={b.id} b={b} />)}</div>
            </section>
          )}
          {ai.length > 0 && (
            <section>
              <SectionTitle title="AI spend guards" hint="Usage plus open reservations; agents are refused when a run would go over" />
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{ai.map((b) => <BudgetCard key={b.id} b={b} />)}</div>
            </section>
          )}
        </div>
      )}
      <Modal open={!!open} onClose={() => setOpen(null)} title={open === "ai" ? "New AI spend guard" : "New budget"}>
        {open && <BudgetForm key={open} scope={open} onDone={() => setOpen(null)} />}
      </Modal>
    </>
  );
}

export default function BudgetsPage() {
  return (
    <Suspense>
      <BudgetsInner />
    </Suspense>
  );
}
