"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Archive, Banknote, CreditCard, Landmark, PiggyBank, Plus, Smartphone, Users, Wallet } from "lucide-react";
import { api, type Account, type Summary } from "@/lib/api";
import { useWs } from "@/lib/hooks";
import { refreshAll, useApp } from "@/providers/app-provider";
import { fmt } from "@/lib/money";
import { accountKindLabel } from "@/lib/labels";
import { Badge, Button, Card, EmptyState, Modal, SectionTitle, Skeleton } from "@/components/ui";
import { PageHeader } from "@/components/finance/page-header";
import { AccountForm } from "@/components/finance/forms";

const ICON: Record<string, React.ElementType> = { bank: Landmark, card: CreditCard, cash: Banknote, mobile_money: Smartphone, ikimina: Users, savings: PiggyBank, ike: PiggyBank, ikze: PiggyBank, ppk: PiggyBank, ejo_heza: PiggyBank };
const GROUPS: { title: string; kinds: string[]; hint: string }[] = [
  { title: "Everyday money", kinds: ["bank", "card", "cash", "credit"], hint: "Banks, cards and cash" },
  { title: "Mobile money & groups", kinds: ["mobile_money", "ikimina", "ejo_heza"], hint: "MTN MoMo, Airtel Money, ikimina savings groups, Ejo Heza" },
  { title: "Saving & retirement", kinds: ["savings", "investment", "ppk", "ike", "ikze"], hint: "Savings, investments, PPK, IKE and IKZE" },
];

function AccountsInner() {
  const params = useSearchParams();
  const { currency } = useApp();
  const { data: accounts } = useWs<Account[]>("/accounts");
  const { data: s } = useWs<Summary>("/reports/summary", true);
  const [open, setOpen] = useState(params.get("new") === "1");
  const conv = new Map(s?.accounts.map((a) => [a.account_id, a.converted]) ?? []);
  const active = accounts?.filter((a) => !a.archived) ?? [];

  return (
    <>
      <PageHeader eyebrow="Accounts" title="Where your money lives" subtitle="Every account keeps its own currency. Totals convert at dated official rates, and anything without a rate is left out, never guessed." actions={<Button onClick={() => setOpen(true)} icon={<Plus size={16} />}>Add account</Button>} />
      {s?.total_balance && active.length > 0 && (
        <Card className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm text-muted">Net worth across accounts ({currency})</p>
            <p className="tnum display mt-1 text-4xl">{fmt(s.total_balance)}</p>
          </div>
          {s.unconverted.length > 0 && <Badge tone="warning">{s.unconverted.join(", ")} left out: no current rate</Badge>}
        </Card>
      )}
      {!accounts ? (
        <Skeleton className="h-48" />
      ) : active.length === 0 ? (
        <EmptyState icon={<Wallet size={20} />} title="No accounts yet" body="Add a bank account, card, cash, MoMo wallet, ikimina share or IKE/IKZE. Opening balances post against opening equity, so the books balance from day one." action={<Button onClick={() => setOpen(true)} icon={<Plus size={16} />}>Add your first account</Button>} />
      ) : (
        <div className="flex flex-col gap-6">
          {GROUPS.map((g) => {
            const rows = active.filter((a) => g.kinds.includes(a.kind));
            if (!rows.length) return null;
            return (
              <section key={g.title}>
                <SectionTitle title={g.title} hint={g.hint} />
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {rows.map((a) => {
                    const Icon = ICON[a.kind] ?? Wallet;
                    const c = conv.get(a.id);
                    return (
                      <Card key={a.id} className="group relative">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-center gap-3">
                            <span className="grid size-10 place-items-center rounded-2xl bg-accent/12 text-accent">
                              <Icon size={18} />
                            </span>
                            <div>
                              <p className="font-semibold">{a.name}</p>
                              <p className="text-xs text-faint">
                                {accountKindLabel(a.kind)}
                                {a.institution ? ` · ${a.institution}` : ""}
                              </p>
                            </div>
                          </div>
                          <Badge>{a.currency}</Badge>
                        </div>
                        <p className="tnum mt-5 text-2xl font-semibold tracking-tight">{fmt(a.balance)}</p>
                        <div className="mt-1 flex items-center justify-between text-xs text-faint">
                          <span>{c && a.currency !== currency ? `≈ ${fmt(c)}` : a.pending.minor !== 0 ? `${fmt(a.pending)} pending` : "Confirmed balance"}</span>
                          <button
                            className="hit inline-flex items-center gap-1 rounded-full px-2 text-xs text-muted opacity-100 hover:text-ink sm:opacity-0 sm:group-hover:opacity-100 sm:focus:opacity-100"
                            onClick={async () => {
                              if (!confirm(`Archive ${a.name}? Its history stays in the ledger.`)) return;
                              await api(`/accounts/${a.id}/archive`, { method: "POST" });
                              refreshAll();
                            }}
                          >
                            <Archive size={13} /> Archive
                          </button>
                        </div>
                      </Card>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="New account">
        <AccountForm onDone={() => setOpen(false)} />
      </Modal>
    </>
  );
}

export default function AccountsPage() {
  return (
    <Suspense>
      <AccountsInner />
    </Suspense>
  );
}
