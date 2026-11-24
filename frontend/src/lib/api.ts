import type { Currency, Money } from "./money";

let workspaceId: string | null = null;
export function setWorkspace(id: string | null) {
  workspaceId = id;
}
export function currentWorkspace() {
  return workspaceId;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function detail(body: unknown, fallback: string): string {
  if (body && typeof body === "object" && "detail" in body) {
    const d = (body as { detail: unknown }).detail;
    if (typeof d === "string") return d;
    if (Array.isArray(d) && d[0]?.msg) return `${d[0].loc?.slice(-1)[0] ?? "field"}: ${d[0].msg}`;
  }
  return fallback;
}

export async function api<T = unknown>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("X-OMH-Client", "web");
  if (workspaceId && !headers.has("X-Workspace-Id")) headers.set("X-Workspace-Id", workspaceId);
  let body = init.body;
  if (init.json !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(init.json);
  }
  const res = await fetch(`/api/v1${path}`, { ...init, headers, body, credentials: "same-origin" });
  const text = await res.text();
  const data = text ? (() => { try { return JSON.parse(text); } catch { return text; } })() : null;
  if (!res.ok) throw new ApiError(res.status, detail(data, res.statusText));
  return data as T;
}

export const fetcher = (path: string) => api(path);

// ---------- types (mirror the API) ----------
export interface Workspace { id: string; name: string; kind: "personal" | "business" | "project"; base_currency: Currency; role: string }
export interface Me { id: string; email: string; display_name: string; is_demo: boolean; reporting_currency: Currency; mfa_enabled: boolean; workspaces: Workspace[] }
export interface Account { id: string; name: string; kind: string; currency: Currency; institution: string | null; color: string | null; archived: boolean; balance: Money; pending: Money }
export interface Category { id: string; name: string; direction: "income" | "expense"; icon: string | null; bucket: string | null }
export interface Txn {
  id: string; kind: string; status: string; date: string; description: string; payee: string | null; amount: Money;
  account_id: string; account: string | null; to_account_id: string | null; to_account: string | null; to_amount: Money | null;
  category_id: string | null; category: string | null; project: string | null; source: string; subscription_id: string | null;
  reversal_of_id: string | null; reversed_by_id: string | null;
}
export interface BudgetView {
  id: string; name: string; scope: "category" | "ai"; category_id: string | null; ai_provider: string | null; currency: Currency;
  allocated: Money; actual: Money; reserved: Money; available: Money; utilization: string; committed_utilization: string;
  state: "on_track" | "warning" | "exceeded"; alert_threshold_pct: number; hard_limit: boolean; period: string; unconverted: Record<string, number>;
}
export interface Reservation { id: string; budget_id: string; purpose: string; agent_id: string | null; amount: Money; status: string; period: string; created_at: string }
export interface Sub {
  id: string; name: string; vendor: string; kind: string; direction: "outgoing" | "incoming"; amount: Money; interval: string; monthly: Money;
  next_renewal: string | null; status: string; account_id: string | null; category_id: string | null; project: string | null; agent_id: string | null;
  notes: string | null; possible_duplicate: boolean;
}
export interface Usage { id: string; provider: string; model: string | null; agent_id: string | null; project: string | null; input_tokens: number; output_tokens: number; cost: Money; date: string; source: string }
export interface Summary {
  currency: Currency; month: string; has_data: boolean; total_balance: Money | null; pending_balance: Money | null;
  monthly_revenue: Money; monthly_expenses: Money; net_cash_flow: Money; subscriptions_monthly: Money; subscriptions_annual: Money;
  ai_subscriptions_monthly: Money; ai_usage_month: Money; ai_operating_cost: Money; infrastructure_monthly: Money;
  client_mrr: Money; client_arr: Money; available_budget: Money | null;
  accounts: { account_id: string; name: string; kind: string; currency: Currency; balance: Money; pending: Money; converted: Money | null }[];
  budgets: BudgetView[]; goals: { id: string; name: string; target: Money; saved: Money | null; progress: string | null; target_date: string | null }[];
  unconverted: string[]; stale_rates: string[]; rates_used: Record<string, { rate: string; effective_date: string | null; source: string }>;
}
export interface Forecast {
  currency: Currency; status: "ok" | "no_accounts"; kind?: "forecast"; history_days?: number; run_rate_applied?: boolean;
  daily_run_rate?: Money; start?: Money; end?: Money; lowest?: { date: string; balance: Money }; days_until_negative?: number | null;
  points: { date: string; balance: Money }[]; events: { date: string; name: string; kind: string; amount: Money }[];
}
export interface Signal { type: string; severity: "info" | "warning" | "danger"; title: string; detail: string; ids: string[] }
export interface Rate { id: string; base: string; quote: string; rate: string; effective_date: string; source: string; provider: string; via: string | null; rate_type: string; source_url: string | null; fetched_at: string }
