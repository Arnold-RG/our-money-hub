"use client";

import { useCallback, useEffect, useState } from "react";
import { Copy, Download, ExternalLink, Landmark, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { api, type Rate } from "@/lib/api";
import { useWs } from "@/lib/hooks";
import { refreshAll, useApp } from "@/providers/app-provider";
import { CURRENCIES, CURRENCY_LABEL, type Currency } from "@/lib/money";
import { niceDate, todayIso } from "@/lib/labels";
import { Badge, Button, Card, ErrorNote, Field, Input, SectionTitle, Select, Skeleton } from "@/components/ui";
import { PageHeader } from "@/components/finance/page-header";

const PROVIDER: Record<string, string> = { nbp: "NBP · Narodowy Bank Polski", ecb: "ECB · European Central Bank", bnr: "BNR · National Bank of Rwanda", manual: "Manual · this workspace only" };

function Rates() {
  const { me } = useApp();
  const { data: rates, mutate } = useWs<Rate[]>("/exchange-rates");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [base, setBase] = useState<Currency>("USD");
  const [quote, setQuote] = useState<Currency>("RWF");
  const [rate, setRate] = useState("");
  const [date, setDate] = useState(todayIso());
  const groups = ["manual", "nbp", "ecb", "bnr"].map((p) => [p, rates?.filter((r) => r.provider === p) ?? []] as const).filter(([, r]) => r.length);
  return (
    <Card id="rates">
      <SectionTitle
        title="Exchange rates"
        hint="Official mid rates with their publication date. Totals use the newest rate in date; an out-of-date rate is refused, not used."
        action={
          !me?.is_demo && (
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              icon={<RefreshCw size={14} />}
              onClick={async () => {
                setBusy(true);
                setMsg(null);
                setError(null);
                try {
                  const r = await api<{ stored: Rate[]; errors: Record<string, string>; cached?: boolean }>("/exchange-rates/sync", { method: "POST" });
                  setMsg(r.cached ? "Rates were synced in the last few minutes." : `Synced ${r.stored.length} rates${Object.keys(r.errors).length ? `; unavailable: ${Object.keys(r.errors).join(", ")}` : ""}.`);
                  mutate();
                  refreshAll();
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Sync now
            </Button>
          )
        }
      />
      {msg && <p className="mb-3 text-sm text-positive">{msg}</p>}
      <ErrorNote error={error} />
      {!rates ? (
        <Skeleton className="h-40" />
      ) : groups.length === 0 ? (
        <p className="text-sm text-muted">No rates on file yet.</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {groups.map(([p, rows]) => (
            <div key={p} className="rounded-2xl border border-line p-4">
              <p className="flex items-center gap-2 text-sm font-semibold">
                <Landmark size={15} className="text-accent" /> {PROVIDER[p] ?? p}
              </p>
              <ul className="mt-3 flex flex-col gap-2 text-sm">
                {rows.map((r) => (
                  <li key={r.id} className="flex items-start justify-between gap-3">
                    <span>
                      1 {r.base} → {r.quote}
                      <span className="block text-xs text-faint">
                        {niceDate(r.effective_date, { day: "numeric", month: "short", year: "numeric" })} · {r.source}
                        {r.via ? ` via ${r.via}` : ""}
                      </span>
                    </span>
                    <span className="tnum font-semibold">{r.rate}</span>
                  </li>
                ))}
              </ul>
              {rows[0]?.source_url && (
                <a href={rows[0].source_url} target="_blank" rel="noreferrer" className="hit mt-1 inline-flex items-center gap-1 text-xs text-accent">
                  Source <ExternalLink size={11} />
                </a>
              )}
            </div>
          ))}
        </div>
      )}
      <form
        className="mt-6 grid gap-3 border-t border-line pt-5 sm:grid-cols-[1fr_1fr_1.2fr_1.2fr_auto] sm:items-end"
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          try {
            await api("/exchange-rates", { method: "POST", json: { base, quote, rate, effective_date: date } });
            setRate("");
            setMsg("Manual rate saved for this workspace.");
            mutate();
            refreshAll();
          } catch (err) {
            setError((err as Error).message);
          }
        }}
      >
        <Field label="From">{(id) => <Select id={id} value={base} onChange={(e) => setBase(e.target.value as Currency)}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</Select>}</Field>
        <Field label="To">{(id) => <Select id={id} value={quote} onChange={(e) => setQuote(e.target.value as Currency)}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</Select>}</Field>
        <Field label="Rate">{(id) => <Input id={id} inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="e.g. 1450.25" required />}</Field>
        <Field label="Effective date">{(id) => <Input id={id} type="date" value={date} onChange={(e) => setDate(e.target.value)} required />}</Field>
        <Button type="submit" variant="secondary">Add manual rate</Button>
      </form>
      <p className="mt-3 text-xs text-faint">Manual rates apply to this workspace only and win over official rates for the same date. Sources: NBP Table A/B (api.nbp.pl), ECB reference rates and BNR, relayed by frankfurter.dev where noted.</p>
    </Card>
  );
}


type TrustedDevice = {
  id: string;
  label: string;
  created_at: string | null;
  last_used_at: string | null;
  expires_at: string | null;
  current: boolean;
};

function when(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}


function TrustedDevices() {
  const [items, setItems] = useState<TrustedDevice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const r = await api<{ items: TrustedDevice[] }>("/auth/trusted-devices");
      setItems(r.items);
      setError(null);
    } catch {
      setItems([]);
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  const revoke = async (id?: string) => {
    setBusy(id ?? "all");
    try {
      await api(id ? `/auth/trusted-devices/${id}` : "/auth/trusted-devices", { method: "DELETE" });
      await load();
    } catch {
      setError("Could not revoke that device.");
    } finally {
      setBusy(null);
    }
  };
  return (
    <Card>
      <SectionTitle
        title="Trusted devices"
        action={items && items.length > 0 ? (
          <Button size="sm" variant="secondary" disabled={busy === "all"} onClick={() => revoke()}>Revoke all</Button>
        ) : undefined}
      />
      <p className="mb-3 text-sm text-muted">After you sign in with your password and authenticator on a device, you can unlock it later with just the authenticator code. Revoke a device if it isn’t yours any more.</p>
      {error && <p role="alert" className="mb-3 text-sm text-danger">{error}</p>}
      {items === null ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted">No trusted devices yet. One is saved the next time you complete sign-in on this device.</p>
      ) : (
        <ul className="divide-y divide-line text-sm">
          {items.map((d) => (
            <li key={d.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 font-medium">
                  {d.label}
                  {d.current && <Badge tone="positive"><span className="inline-flex items-center gap-1"><ShieldCheck size={12} /> This device</span></Badge>}
                </div>
                <div className="text-xs text-faint">Last used {when(d.last_used_at)} · Expires {when(d.expires_at)}</div>
              </div>
              <Button type="button" variant="secondary" size="sm" disabled={busy === d.id} onClick={() => revoke(d.id)} icon={<Trash2 size={14} />}>Revoke</Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Security() {
  const { me, refreshMe } = useApp();
  const [setup, setSetup] = useState<{ secret: string; otpauth_uri: string } | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  if (!me) return null;
  return (
    <Card>
      <SectionTitle title="Two-step sign-in" hint="Authenticator app codes (TOTP). Secrets are stored encrypted." />
      {me.mfa_enabled ? (
        <p className="flex items-center gap-2 text-sm text-positive">
          <ShieldCheck size={17} /> On for this account.
        </p>
      ) : me.is_demo ? (
        <p className="text-sm text-muted">Not available in a demo session.</p>
      ) : setup ? (
        <form
          className="flex flex-col gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await api("/auth/mfa/enable", { method: "POST", json: { code } });
              setSetup(null);
              refreshMe();
            } catch (err) {
              setError((err as Error).message);
            }
          }}
        >
          <p className="text-sm text-muted">Add this key to your authenticator app, then enter the 6-digit code it shows.</p>
          <code className="break-all rounded-xl bg-surface-3 px-3 py-2 text-sm">{setup.secret}</code>
          <Field label="Code">{(id) => <Input id={id} inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} required />}</Field>
          <ErrorNote error={error} />
          <Button type="submit">Turn on</Button>
        </form>
      ) : (
        <Button variant="secondary" onClick={async () => setSetup(await api("/auth/mfa/setup", { method: "POST" }))} icon={<ShieldCheck size={16} />}>
          Set up two-step sign-in
        </Button>
      )}
    </Card>
  );
}

function RecoveryCodesCard() {
  const { me, refreshMe } = useApp();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  if (!me?.mfa_enabled) return null;
  const remaining = me.recovery_codes_remaining ?? 0;

  const resetForm = () => {
    setOpen(false);
    setPassword("");
    setCode("");
    setError(null);
  };

  return (
    <Card>
      <SectionTitle title="New recovery codes" hint="Each code signs you in once if you lose your authenticator." />
      {codes ? (
        <div className="min-w-0">
          <p className="mb-3 text-sm text-warning" role="status">Old codes no longer work. Save these now.</p>
          <ul className="grid grid-cols-2 gap-2 font-mono text-xs sm:text-sm">
            {codes.map((c) => (
              <li key={c} className="min-w-0 truncate rounded-xl border border-line bg-surface-3 px-3 py-2">{c}</li>
            ))}
          </ul>
          <div className="mt-4 flex min-w-0 flex-col gap-2 sm:flex-row">
            <Button type="button" variant="secondary" className="w-full sm:w-auto" icon={<Copy size={14} />} onClick={async () => {
              try {
                await navigator.clipboard.writeText(codes.join("\n"));
                setCopied(true);
                window.setTimeout(() => setCopied(false), 2000);
              } catch {
                setError("Could not copy. Select the codes and copy them yourself.");
              }
            }}>{copied ? "Copied" : "Copy all"}</Button>
            <Button type="button" variant="secondary" className="w-full sm:w-auto" icon={<Download size={14} />} onClick={() => {
              const blob = new Blob([`${codes.join("\n")}\n`], { type: "text/plain" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = "our-money-hub-recovery-codes.txt";
              a.click();
              URL.revokeObjectURL(url);
            }}>Download .txt</Button>
          </div>
          <ErrorNote error={error} />
          <Button
            className="mt-3 w-full sm:w-auto"
            type="button"
            onClick={async () => {
              setCodes(null);
              setCopied(false);
              setError(null);
              await refreshMe();
            }}
          >
            I’ve saved these codes
          </Button>
        </div>
      ) : (
        <>
          <p className="mb-3 text-sm text-muted">{remaining} of 10 left</p>
          {open ? (
            <form className="flex min-w-0 flex-col gap-3" onSubmit={async (e) => {
              e.preventDefault();
              setError(null);
              setBusy(true);
              try {
                const r = await api<{ recovery_codes?: string[] }>("/auth/mfa/recovery-codes/regenerate", {
                  method: "POST",
                  json: { password, code },
                });
                if (r.recovery_codes?.length) {
                  setCodes(r.recovery_codes);
                  resetForm();
                  await refreshMe();
                }
              } catch (err) {
                setError((err as Error).message);
              } finally {
                setBusy(false);
              }
            }}
            >
              <p className="text-sm text-warning" role="status">Old codes will no longer work once you create a new list. Save the new codes somewhere safe.</p>
              <Field label="Current password">
                {(id) => (
                  <Input
                    id={id}
                    type="password"
                    autoComplete="current-password"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                )}
              </Field>
              <Field label="Authenticator code">
                {(id) => (
                  <Input
                    id={id}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    pattern="[0-9]{6}"
                    maxLength={6}
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    required
                  />
                )}
              </Field>
              <ErrorNote error={error} />
              <div className="flex min-w-0 flex-col gap-2 sm:flex-row">
                <Button type="submit" disabled={busy} className="w-full sm:w-auto">Get new codes</Button>
                <Button type="button" variant="ghost" disabled={busy} className="w-full sm:w-auto" onClick={resetForm}>Cancel</Button>
              </div>
            </form>
          ) : (
            <Button type="button" variant="secondary" onClick={() => setOpen(true)}>Get new codes</Button>
          )}
        </>
      )}
    </Card>
  );
}

function WorkspaceCard() {
  const { workspace, refreshMe } = useApp();
  const [name, setName] = useState(workspace?.name ?? "");
  const [base, setBase] = useState<Currency>(workspace?.base_currency ?? "PLN");
  const [saved, setSaved] = useState(false);
  if (!workspace) return null;
  return (
    <Card>
      <SectionTitle title="Workspace" hint="Personal and Business books are completely separate." />
      <form
        className="flex flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          await api("/workspaces/current", { method: "PATCH", json: { name, base_currency: base } });
          await refreshMe();
          setSaved(true);
        }}
      >
        <Field label="Name">{(id) => <Input id={id} value={name} onChange={(e) => { setName(e.target.value); setSaved(false); }} />}</Field>
        <Field label="Home currency" hint="Default for new accounts and budgets">
          {(id) => (
            <Select id={id} value={base} onChange={(e) => { setBase(e.target.value as Currency); setSaved(false); }}>
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c} · {CURRENCY_LABEL[c]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <div className="flex items-center gap-3">
          <Button type="submit" variant="secondary">Save</Button>
          {saved && <Badge tone="positive">Saved</Badge>}
        </div>
      </form>
    </Card>
  );
}

export default function SettingsPage() {
  const { workspace } = useApp();
  return (
    <>
      <PageHeader eyebrow="Settings" title="Rates, workspace and security" />
      <div className="flex flex-col gap-6">
        <Rates />
        <div className="grid gap-6 lg:grid-cols-2">
          <WorkspaceCard key={workspace?.id} />
          <Security />
          <RecoveryCodesCard />
          <TrustedDevices />
        </div>
        <Card>
          <SectionTitle title="About" />
          <p className="text-sm text-muted">
            Our Money Hub, the financial engine of the Arnova ecosystem. Created by Arnold Rurangwa / Arnova Group.
          </p>
          <p className="mt-2 text-xs text-faint">Money is stored in whole minor units (grosze, cents, francs) and every entry is double-entry balanced.</p>
        </Card>
      </div>
    </>
  );
}
