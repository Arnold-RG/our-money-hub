export const ACCOUNT_KINDS: { value: string; label: string; group: string; hint?: string }[] = [
  { value: "bank", label: "Bank account", group: "Everyday" },
  { value: "card", label: "Card", group: "Everyday" },
  { value: "cash", label: "Cash", group: "Everyday" },
  { value: "credit", label: "Credit / loan", group: "Everyday" },
  { value: "mobile_money", label: "Mobile money (MTN MoMo, Airtel Money)", group: "Rwanda" },
  { value: "ikimina", label: "Ikimina (savings group)", group: "Rwanda", hint: "Your share of a rotating savings group" },
  { value: "ejo_heza", label: "Ejo Heza", group: "Rwanda", hint: "Long-term savings scheme" },
  { value: "savings", label: "Savings", group: "Saving & investing" },
  { value: "investment", label: "Investments", group: "Saving & investing" },
  { value: "ppk", label: "PPK (employee capital plan)", group: "Poland retirement" },
  { value: "ike", label: "IKE (individual retirement account)", group: "Poland retirement" },
  { value: "ikze", label: "IKZE (retirement security account)", group: "Poland retirement" },
];
export const accountKindLabel = (k: string) => ACCOUNT_KINDS.find((a) => a.value === k)?.label.split(" (")[0] ?? k;

export const SUB_KINDS = [
  { value: "ai", label: "AI tool" },
  { value: "api", label: "API usage plan" },
  { value: "hosting", label: "Hosting" },
  { value: "domain", label: "Domain" },
  { value: "software", label: "Software" },
  { value: "media", label: "Media" },
  { value: "client", label: "Client plan (income)" },
  { value: "other", label: "Other" },
];
export const INTERVALS = [
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "yearly", label: "Yearly" },
];
export const AI_PROVIDERS = [
  { value: "openai", label: "OpenAI" },
  { value: "xai", label: "xAI" },
  { value: "anthropic", label: "Anthropic" },
  { value: "google", label: "Google" },
  { value: "other", label: "Other" },
];
export const providerLabel = (p: string | null) => AI_PROVIDERS.find((a) => a.value === p)?.label ?? "All providers";

export function todayIso(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function niceDate(iso: string | null | undefined, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", { ...opts, timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
}

export function daysFromToday(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date();
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(t.getFullYear(), t.getMonth(), t.getDate())) / 86400000);
}
