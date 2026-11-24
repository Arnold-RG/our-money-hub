"use client";

import { useMemo, useState } from "react";
import { api, type Account, type BudgetView, type Category } from "@/lib/api";
import { refreshAll, useApp } from "@/providers/app-provider";
import { useWs } from "@/lib/hooks";
import { CURRENCIES, CURRENCY_LABEL, MINOR_UNITS, validateAmountInput, type Currency } from "@/lib/money";
import { ACCOUNT_KINDS, AI_PROVIDERS, INTERVALS, SUB_KINDS, todayIso } from "@/lib/labels";
import { Button, ErrorNote, Field, Input, Segmented, Select } from "@/components/ui";

function useSubmit(onDone: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await refreshAll();
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, setError, run };
}

function CurrencySelect({ id, value, onChange }: { id: string; value: Currency; onChange: (c: Currency) => void }) {
  return (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value as Currency)}>
      {CURRENCIES.map((c) => (
        <option key={c} value={c}>
          {c} · {CURRENCY_LABEL[c]}
        </option>
      ))}
    </Select>
  );
}

function AmountField({ label, value, onChange, currency, hint, allowNegative }: { label: string; value: string; onChange: (v: string) => void; currency: Currency; hint?: string; allowNegative?: boolean }) {
  const err = !value ? null : !allowNegative && value.trim().startsWith("-") ? "Enter a positive amount" : validateAmountInput(value, currency);
  return (
    <Field label={label} hint={hint ?? (MINOR_UNITS[currency] === 0 ? "Whole francs only" : `Up to ${MINOR_UNITS[currency]} decimals`)} error={err}>
      {(id) => <Input id={id} inputMode="decimal" className="tnum" value={value} onChange={(e) => onChange(e.target.value)} placeholder={MINOR_UNITS[currency] === 0 ? "0" : "0.00"} required />}
    </Field>
  );
}

export function AccountForm({ onDone }: { onDone: () => void }) {
  const { workspace } = useApp();
  const [name, setName] = useState("");
  const [kind, setKind] = useState("bank");
  const [currency, setCurrency] = useState<Currency>(workspace?.base_currency ?? "PLN");
  const [institution, setInstitution] = useState("");
  const [opening, setOpening] = useState("");
  const [date, setDate] = useState(todayIso());
  const { busy, error, run } = useSubmit(onDone);
  const groups = [...new Set(ACCOUNT_KINDS.map((k) => k.group))];
  const hint = ACCOUNT_KINDS.find((k) => k.value === kind)?.hint;
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => api("/accounts", { method: "POST", json: { name, kind, currency, institution: institution || null, opening_balance: opening || "0", opening_date: date } }));
      }}
    >
      <Field label="Account name">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. mBank personal, MTN MoMo" required />}</Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Type" hint={hint}>
          {(id) => (
            <Select id={id} value={kind} onChange={(e) => setKind(e.target.value)}>
              {groups.map((g) => (
                <optgroup key={g} label={g}>
                  {ACCOUNT_KINDS.filter((k) => k.group === g).map((k) => (
                    <option key={k.value} value={k.value}>
                      {k.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Currency">{(id) => <CurrencySelect id={id} value={currency} onChange={setCurrency} />}</Field>
      </div>
      <Field label="Institution (optional)">{(id) => <Input id={id} value={institution} onChange={(e) => setInstitution(e.target.value)} placeholder="Bank, operator or group name" />}</Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <AmountField label="Opening balance" value={opening} onChange={setOpening} currency={currency} allowNegative hint="Posted against opening equity" />
        <Field label="As of">{(id) => <Input id={id} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
      </div>
      <ErrorNote error={error} />
      <Button type="submit" disabled={busy}>Add account</Button>
    </form>
  );
}

type Kind = "expense" | "income" | "transfer";
export function TxnForm({ onDone, initialKind = "expense" }: { onDone: () => void; initialKind?: Kind }) {
  const { data: accounts = [] } = useWs<Account[]>("/accounts");
  const { data: cats = [] } = useWs<Category[]>("/categories");
  const active = accounts.filter((a) => !a.archived);
  const [kind, setKind] = useState<Kind>(initialKind);
  const [accountId, setAccountId] = useState("");
  const [toId, setToId] = useState("");
  const [amount, setAmount] = useState("");
  const [toAmount, setToAmount] = useState("");
  const [date, setDate] = useState(todayIso());
  const [desc, setDesc] = useState("");
  const [payee, setPayee] = useState("");
  const [cat, setCat] = useState("");
  const [project, setProject] = useState("");
  const [pending, setPending] = useState(false);
  const { busy, error, run } = useSubmit(onDone);
  const acc = active.find((a) => a.id === accountId) ?? active[0];
  const to = active.find((a) => a.id === toId);
  const cross = kind === "transfer" && acc && to && acc.currency !== to.currency;
  const catOptions = useMemo(() => cats.filter((c) => c.direction === (kind === "income" ? "income" : "expense")), [cats, kind]);

  if (!active.length) return <p className="text-sm text-muted">Add an account first. Every payment belongs to one.</p>;
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(() =>
          api("/transactions", {
            method: "POST",
            json: {
              kind,
              account_id: acc!.id,
              amount,
              currency: acc!.currency,
              date,
              description: desc,
              payee: payee || null,
              category_id: kind === "transfer" ? null : cat || null,
              to_account_id: kind === "transfer" ? toId || null : null,
              to_amount: cross ? toAmount : null,
              project: project || null,
              status: pending ? "pending" : "confirmed",
            },
          }),
        );
      }}
    >
      <Segmented label="Payment type" value={kind} onChange={setKind} options={[{ value: "expense", label: "Expense" }, { value: "income", label: "Income" }, { value: "transfer", label: "Transfer" }]} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={kind === "transfer" ? "From" : "Account"}>
          {(id) => (
            <Select id={id} value={acc?.id} onChange={(e) => setAccountId(e.target.value)}>
              {active.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} · {a.currency}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {kind === "transfer" ? (
          <Field label="To">
            {(id) => (
              <Select id={id} value={toId} onChange={(e) => setToId(e.target.value)} required>
                <option value="">Choose account</option>
                {active.filter((a) => a.id !== acc?.id).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} · {a.currency}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        ) : (
          <Field label="Category">
            {(id) => (
              <Select id={id} value={cat} onChange={(e) => setCat(e.target.value)}>
                <option value="">Uncategorised</option>
                {catOptions.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {acc && <AmountField label={`Amount (${acc.currency})`} value={amount} onChange={setAmount} currency={acc.currency} />}
        {cross && to ? (
          <AmountField label={`Arrives as (${to.currency})`} value={toAmount} onChange={setToAmount} currency={to.currency} hint="What actually landed; the difference posts to FX clearing" />
        ) : (
          <Field label="Date">{(id) => <Input id={id} type="date" value={date} onChange={(e) => setDate(e.target.value)} required />}</Field>
        )}
      </div>
      {cross && <Field label="Date">{(id) => <Input id={id} type="date" value={date} onChange={(e) => setDate(e.target.value)} required />}</Field>}
      <Field label="Description">{(id) => <Input id={id} value={desc} onChange={(e) => setDesc(e.target.value)} required maxLength={255} />}</Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Payee (optional)">{(id) => <Input id={id} value={payee} onChange={(e) => setPayee(e.target.value)} />}</Field>
        <Field label="Project (optional)">{(id) => <Input id={id} value={project} onChange={(e) => setProject(e.target.value)} placeholder="Client or product" />}</Field>
      </div>
      <label className="flex items-center gap-2 text-sm text-muted">
        <input type="checkbox" checked={pending} onChange={(e) => setPending(e.target.checked)} className="size-4 accent-[var(--omh-accent)]" /> Pending (not cleared yet)
      </label>
      <ErrorNote error={error} />
      <Button type="submit" disabled={busy}>Save payment</Button>
    </form>
  );
}

export function BudgetForm({ onDone, scope: initialScope = "category" }: { onDone: () => void; scope?: "category" | "ai" }) {
  const { workspace } = useApp();
  const { data: cats = [] } = useWs<Category[]>("/categories");
  const [scope, setScope] = useState<"category" | "ai">(initialScope);
  const [name, setName] = useState("");
  const [cat, setCat] = useState("");
  const [provider, setProvider] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState<Currency>(workspace?.base_currency ?? "PLN");
  const [threshold, setThreshold] = useState(80);
  const [hard, setHard] = useState(initialScope === "ai");
  const { busy, error, run } = useSubmit(onDone);
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(() =>
          api("/budgets", {
            method: "POST",
            json: { name, scope, category_id: scope === "category" ? cat : null, ai_provider: scope === "ai" ? provider || null : null, amount, currency, alert_threshold_pct: threshold, hard_limit: hard },
          }),
        );
      }}
    >
      <Segmented label="Budget type" value={scope} onChange={(v) => { setScope(v); setHard(v === "ai"); }} options={[{ value: "category", label: "Spending category" }, { value: "ai", label: "AI spend guard" }]} />
      <Field label="Name">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} placeholder={scope === "ai" ? "e.g. Agents · monthly" : "e.g. Groceries"} required />}</Field>
      {scope === "category" ? (
        <Field label="Category">
          {(id) => (
            <Select id={id} value={cat} onChange={(e) => setCat(e.target.value)} required>
              <option value="">Choose a category</option>
              {cats.filter((c) => c.direction === "expense").map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      ) : (
        <Field label="Provider" hint="Leave on all to cover every AI provider">
          {(id) => (
            <Select id={id} value={provider} onChange={(e) => setProvider(e.target.value)}>
              <option value="">All providers</option>
              {AI_PROVIDERS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <AmountField label="Monthly limit" value={amount} onChange={setAmount} currency={currency} />
        <Field label="Currency">{(id) => <CurrencySelect id={id} value={currency} onChange={setCurrency} />}</Field>
      </div>
      <Field label={`Alert at ${threshold}%`}>
        {(id) => <input id={id} type="range" min={50} max={100} step={5} value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} className="accent-[var(--omh-accent)]" />}
      </Field>
      <label className="flex items-start gap-2 text-sm text-muted">
        <input type="checkbox" checked={hard} onChange={(e) => setHard(e.target.checked)} className="mt-0.5 size-4 accent-[var(--omh-accent)]" />
        <span>Hard limit: refuse reservations that would go over. {scope === "ai" && <span className="text-faint">Agents asking through the API are always held to the limit.</span>}</span>
      </label>
      <ErrorNote error={error} />
      <Button type="submit" disabled={busy}>Create budget</Button>
    </form>
  );
}

export function SubForm({ onDone }: { onDone: () => void }) {
  const { workspace } = useApp();
  const { data: accounts = [] } = useWs<Account[]>("/accounts");
  const [name, setName] = useState("");
  const [vendor, setVendor] = useState("");
  const [kind, setKind] = useState("ai");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState<Currency>("USD");
  const [interval, setInterval] = useState("monthly");
  const [next, setNext] = useState("");
  const [status, setStatus] = useState("active");
  const [account, setAccount] = useState("");
  const [project, setProject] = useState("");
  const { busy, error, run } = useSubmit(onDone);
  const direction = kind === "client" ? "incoming" : "outgoing";
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(() =>
          api("/subscriptions", {
            method: "POST",
            json: { name, vendor: vendor || name, kind, direction, amount, currency, interval, next_renewal: next || null, status, account_id: account || null, project: project || null },
          }),
        );
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === "client" ? "Client plan" : "e.g. ChatGPT Plus"} required />}</Field>
        <Field label={direction === "incoming" ? "Client" : "Vendor"}>{(id) => <Input id={id} value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="Used to spot duplicates" />}</Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Type">
          {(id) => (
            <Select id={id} value={kind} onChange={(e) => setKind(e.target.value)}>
              {SUB_KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Status">
          {(id) => (
            <Select id={id} value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="active">Active</option>
              <option value="trial">Free trial</option>
              <option value="paused">Paused</option>
            </Select>
          )}
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <AmountField label="Price" value={amount} onChange={setAmount} currency={currency} />
        <Field label="Currency">{(id) => <CurrencySelect id={id} value={currency} onChange={setCurrency} />}</Field>
        <Field label="Billing">
          {(id) => (
            <Select id={id} value={interval} onChange={(e) => setInterval(e.target.value)}>
              {INTERVALS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Next renewal">{(id) => <Input id={id} type="date" value={next} onChange={(e) => setNext(e.target.value)} />}</Field>
        <Field label={direction === "incoming" ? "Paid into" : "Paid from"} hint="Needed to record payments">
          {(id) => (
            <Select id={id} value={account} onChange={(e) => setAccount(e.target.value)}>
              <option value="">Not set</option>
              {accounts.filter((a) => !a.archived).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} · {a.currency}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <Field label="Project (optional)">{(id) => <Input id={id} value={project} onChange={(e) => setProject(e.target.value)} placeholder={workspace?.kind === "business" ? "Product or client" : ""} />}</Field>
      <ErrorNote error={error} />
      <Button type="submit" disabled={busy}>Add subscription</Button>
    </form>
  );
}

export function UsageForm({ onDone }: { onDone: () => void }) {
  const [provider, setProvider] = useState("openai");
  const [model, setModel] = useState("");
  const [agent, setAgent] = useState("");
  const [cost, setCost] = useState("");
  const [currency, setCurrency] = useState<Currency>("USD");
  const [date, setDate] = useState(todayIso());
  const [inTok, setInTok] = useState("");
  const [outTok, setOutTok] = useState("");
  const { busy, error, run } = useSubmit(onDone);
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(() =>
          api("/ai-usage", {
            method: "POST",
            json: { provider, model: model || null, agent_id: agent || null, cost, currency, date, input_tokens: Number(inTok || 0), output_tokens: Number(outTok || 0) },
          }),
        );
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Provider">
          {(id) => (
            <Select id={id} value={provider} onChange={(e) => setProvider(e.target.value)}>
              {AI_PROVIDERS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Model (optional)">{(id) => <Input id={id} value={model} onChange={(e) => setModel(e.target.value)} />}</Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <AmountField label="Cost" value={cost} onChange={setCost} currency={currency} />
        <Field label="Currency">{(id) => <CurrencySelect id={id} value={currency} onChange={setCurrency} />}</Field>
        <Field label="Date">{(id) => <Input id={id} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Agent (optional)">{(id) => <Input id={id} value={agent} onChange={(e) => setAgent(e.target.value)} />}</Field>
        <Field label="Input tokens">{(id) => <Input id={id} inputMode="numeric" value={inTok} onChange={(e) => setInTok(e.target.value.replace(/\D/g, ""))} />}</Field>
        <Field label="Output tokens">{(id) => <Input id={id} inputMode="numeric" value={outTok} onChange={(e) => setOutTok(e.target.value.replace(/\D/g, ""))} />}</Field>
      </div>
      <ErrorNote error={error} />
      <Button type="submit" disabled={busy}>Record usage</Button>
    </form>
  );
}

export function ReserveForm({ budgets, onDone }: { budgets: BudgetView[]; onDone: () => void }) {
  const ai = budgets.filter((b) => b.scope === "ai");
  const [bid, setBid] = useState(ai[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [purpose, setPurpose] = useState("");
  const [agent, setAgent] = useState("");
  const { busy, error, run } = useSubmit(onDone);
  const b = ai.find((x) => x.id === bid);
  if (!ai.length) return <p className="text-sm text-muted">Create an AI budget first.</p>;
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => api("/budget-reservations", { method: "POST", json: { budget_id: bid, amount, purpose, agent_id: agent || null } }));
      }}
    >
      <Field label="AI budget">
        {(id) => (
          <Select id={id} value={bid} onChange={(e) => setBid(e.target.value)}>
            {ai.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name} · {x.available.amount} {x.currency} available
              </option>
            ))}
          </Select>
        )}
      </Field>
      {b && <AmountField label={`Hold (${b.currency})`} value={amount} onChange={setAmount} currency={b.currency} />}
      <Field label="Purpose">{(id) => <Input id={id} value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="e.g. Nightly research run" required />}</Field>
      <Field label="Agent (optional)">{(id) => <Input id={id} value={agent} onChange={(e) => setAgent(e.target.value)} />}</Field>
      <ErrorNote error={error} />
      <Button type="submit" disabled={busy}>Reserve</Button>
    </form>
  );
}
