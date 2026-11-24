"use client";

import { Suspense, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowDownRight, ArrowLeftRight, ArrowUpRight, Download, FileUp, Plus, RotateCcw, Search, Undo2 } from "lucide-react";
import { api, type Txn } from "@/lib/api";
import { useWs } from "@/lib/hooks";
import { refreshAll, useApp } from "@/providers/app-provider";
import { fmt, type Money } from "@/lib/money";
import { niceDate } from "@/lib/labels";
import { Badge, Button, Card, EmptyState, ErrorNote, Input, Modal, Segmented, Skeleton, cx } from "@/components/ui";
import { PageHeader } from "@/components/finance/page-header";
import { TxnForm } from "@/components/finance/forms";

interface Preview { rows: { line: number; errors: string[]; duplicate: boolean; parsed: null | { date: string; description: string; amount: Money; account?: string; category?: string } }[]; importable: number; errors: number; duplicates: number }

function ImportDialog({ onDone }: { onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const send = async (path: string, f: File) => {
    const fd = new FormData();
    fd.append("file", f);
    return api(path, { method: "POST", body: fd });
  };
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">
        Columns: <code className="rounded bg-surface-3 px-1.5 py-0.5 text-xs">date, description, amount, currency, account</code> and optionally <code className="rounded bg-surface-3 px-1.5 py-0.5 text-xs">category, payee, project</code>. Negative amounts are expenses. You see a preview first; rows already imported are skipped.
      </p>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        className="sr-only"
        aria-label="CSV file"
        onChange={async (e) => {
          const f = e.target.files?.[0] ?? null;
          setFile(f);
          setPreview(null);
          setError(null);
          if (!f) return;
          setBusy(true);
          try {
            setPreview((await send("/transactions/import/preview", f)) as Preview);
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      />
      <Button variant="secondary" onClick={() => inputRef.current?.click()} icon={<FileUp size={16} />}>
        {file ? file.name : "Choose CSV file"}
      </Button>
      <ErrorNote error={error} />
      {preview && (
        <>
          <div className="flex flex-wrap gap-2">
            <Badge tone="positive">{preview.importable} ready</Badge>
            {preview.duplicates > 0 && <Badge tone="info">{preview.duplicates} already imported</Badge>}
            {preview.errors > 0 && <Badge tone="danger">{preview.errors} with errors</Badge>}
          </div>
          <div className="max-h-64 overflow-auto rounded-xl border border-line">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-surface-2 text-muted">
                <tr>
                  <th className="px-3 py-2">Line</th>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Description</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                  <th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {preview.rows.map((r) => (
                  <tr key={r.line}>
                    <td className="px-3 py-2 text-faint">{r.line}</td>
                    <td className="px-3 py-2">{r.parsed?.date ?? "—"}</td>
                    <td className="max-w-[12rem] truncate px-3 py-2">{r.parsed?.description ?? "—"}</td>
                    <td className="tnum px-3 py-2 text-right">{r.parsed ? fmt(r.parsed.amount) : "—"}</td>
                    <td className="px-3 py-2">{r.errors.length ? <span className="text-danger">{r.errors.join("; ")}</span> : r.duplicate ? <span className="text-info">duplicate</span> : <span className="text-positive">ok</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Button
            disabled={busy || preview.importable === 0}
            onClick={async () => {
              if (!file) return;
              setBusy(true);
              try {
                await send("/transactions/import/commit", file);
                await refreshAll();
                onDone();
              } catch (err) {
                setError((err as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Import {preview.importable} row{preview.importable === 1 ? "" : "s"}
          </Button>
        </>
      )}
    </div>
  );
}

function TxnInner() {
  const params = useSearchParams();
  const { workspace } = useApp();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [kind, setKind] = useState<"all" | "income" | "expense" | "transfer">("all");
  const [open, setOpen] = useState(params.get("new") === "1");
  const [importOpen, setImportOpen] = useState(params.get("import") === "1");
  const [reverse, setReverse] = useState<Txn | null>(null);
  const [error, setError] = useState<string | null>(null);
  const path = useMemo(() => `/transactions?limit=300${q ? `&q=${encodeURIComponent(q)}` : ""}${kind !== "all" ? `&kind=${kind}` : ""}`, [q, kind]);
  const { data: txns } = useWs<Txn[]>(path);

  const groups = useMemo(() => {
    const m = new Map<string, Txn[]>();
    txns?.forEach((t) => m.set(t.date, [...(m.get(t.date) ?? []), t]));
    return [...m.entries()];
  }, [txns]);

  return (
    <>
      <PageHeader
        eyebrow="Payments"
        title="Every złoty, franc, euro and dollar"
        subtitle="Posted payments are never edited or deleted. A mistake is corrected with a reversal, so the history always adds up."
        actions={
          <>
            <a href={`/api/v1/transactions/export.csv?ws=${workspace?.id ?? ""}`} className="inline-flex h-11 items-center gap-2 rounded-full border border-line-strong bg-surface-2 px-4 text-sm font-medium hover:bg-surface-3">
              <Download size={16} /> Export
            </a>
            <Button variant="secondary" onClick={() => setImportOpen(true)} icon={<FileUp size={16} />}>
              Import CSV
            </Button>
            <Button onClick={() => setOpen(true)} icon={<Plus size={16} />}>
              Add payment
            </Button>
          </>
        }
      />
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-faint" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search description or payee" aria-label="Search payments" className="pl-10" />
        </div>
        <Segmented label="Filter" value={kind} onChange={setKind} options={[{ value: "all", label: "All" }, { value: "income", label: "In" }, { value: "expense", label: "Out" }, { value: "transfer", label: "Moves" }]} />
      </div>
      {!txns ? (
        <Skeleton className="h-64" />
      ) : txns.length === 0 ? (
        <EmptyState icon={<ArrowLeftRight size={20} />} title={q || kind !== "all" ? "Nothing matches" : "No payments yet"} body={q || kind !== "all" ? "Try another search or filter." : "Record income, an expense or a transfer, or import a CSV export from your bank."} action={!q && kind === "all" ? <Button onClick={() => setOpen(true)} icon={<Plus size={16} />}>Add payment</Button> : undefined} />
      ) : (
        <Card className="p-0 sm:p-0">
          {groups.map(([date, rows]) => (
            <div key={date}>
              <div className="sticky top-16 z-10 border-b border-line bg-surface/90 px-5 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-faint backdrop-blur">{niceDate(date, { weekday: "long", day: "numeric", month: "long" })}</div>
              <ul className="divide-y divide-line">
                {rows.map((t) => {
                  const reversed = !!t.reversed_by_id;
                  const isRev = t.kind === "reversal";
                  return (
                    <li key={t.id} className={cx("flex items-center gap-3 px-4 py-3.5 sm:px-5", (reversed || isRev) && "opacity-70")}>
                      <span className={cx("hidden size-10 shrink-0 place-items-center rounded-2xl sm:grid", t.kind === "income" ? "bg-positive/15 text-positive" : t.kind === "expense" ? "bg-accent-2/15 text-accent-2" : isRev ? "bg-surface-3 text-muted" : "bg-info/15 text-info")}>
                        {t.kind === "income" ? <ArrowUpRight size={17} /> : t.kind === "expense" ? <ArrowDownRight size={17} /> : isRev ? <Undo2 size={17} /> : <ArrowLeftRight size={17} />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className={cx("truncate text-sm font-medium", reversed && "line-through")}>{t.description}</p>
                        <p className="truncate text-xs text-faint">
                          {t.kind === "transfer" ? `${t.account} → ${t.to_account}` : t.account}
                          {t.category ? ` · ${t.category}` : ""}
                          {t.payee ? ` · ${t.payee}` : ""}
                          {t.project ? ` · ${t.project}` : ""}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className={cx("tnum whitespace-nowrap text-sm font-semibold", t.kind === "income" && "text-positive")}>{fmt(t.amount, { sign: t.kind === "income" })}</p>
                        <p className="text-xs text-faint">
                          {t.to_amount ? `→ ${fmt(t.to_amount)}` : t.status === "pending" ? "pending" : reversed ? "reversed" : isRev ? "reversal" : t.source !== "manual" ? t.source : ""}
                        </p>
                      </div>
                      {!reversed && !isRev && (
                        <button onClick={() => setReverse(t)} className="hit grid place-items-center rounded-full text-faint hover:bg-surface-3 hover:text-ink" aria-label={`Reverse ${t.description}`}>
                          <RotateCcw size={15} />
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </Card>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="New payment" wide>
        <TxnForm onDone={() => setOpen(false)} />
      </Modal>
      <Modal open={importOpen} onClose={() => setImportOpen(false)} title="Import CSV" wide>
        <ImportDialog onDone={() => setImportOpen(false)} />
      </Modal>
      <Modal open={!!reverse} onClose={() => { setReverse(null); setError(null); }} title="Reverse this payment?">
        {reverse && (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted">
              A mirror entry cancels <span className="font-medium text-ink">{reverse.description}</span> ({fmt(reverse.amount)}). The original stays in the history, marked as reversed.
            </p>
            <ErrorNote error={error} />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setReverse(null)}>Cancel</Button>
              <Button
                variant="danger"
                onClick={async () => {
                  try {
                    await api(`/transactions/${reverse.id}/reverse`, { method: "POST", json: {} });
                    await refreshAll();
                    setReverse(null);
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                Reverse
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}

export default function TransactionsPage() {
  return (
    <Suspense>
      <TxnInner />
    </Suspense>
  );
}
