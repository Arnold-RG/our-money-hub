import { ArrowLeftRight, Bot, CalendarRange, ChartNoAxesCombined, Gauge, LayoutDashboard, Landmark, PiggyBank, Plus, Repeat, Search, Settings, Wallet } from "lucide-react";

export const NAV = [
  { href: "/dashboard", label: "Home", icon: LayoutDashboard, group: "Money" },
  { href: "/accounts", label: "Accounts", icon: Wallet, group: "Money" },
  { href: "/transactions", label: "Transactions", icon: ArrowLeftRight, group: "Money", countKey: "pending_txns" },
  { href: "/budgets", label: "Budgets", icon: Gauge, group: "Money", countKey: "budget_alerts" },
  { href: "/my-finances", label: "My finances", icon: PiggyBank, group: "Money" },
  { href: "/future-projects", label: "Future projects", icon: CalendarRange, group: "Money" },
  { href: "/subscriptions", label: "Subscriptions", icon: Repeat, group: "Money" },
  { href: "/reports", label: "Reports", icon: ChartNoAxesCombined, group: "Insight" },
  { href: "/ai", label: "AI spend", icon: Bot, group: "Insight" },
  { href: "/settings", label: "Settings", icon: Settings, group: "Insight" },
] as const;

export const GROUPS = ["Money", "Insight"] as const;

// Phone tabs: Home · Activity · Add · Budgets · Search
export const DOCK = [
  { href: "/dashboard", label: "Home", icon: LayoutDashboard },
  { href: "/transactions", label: "Activity", icon: ArrowLeftRight },
  { href: "/budgets", label: "Budgets", icon: Gauge },
] as const;

export const MORE = [
  { href: "/accounts", label: "Accounts", icon: Wallet, hint: "Banks, MoMo, cash, IKE/IKZE" },
  { href: "/subscriptions", label: "Subscriptions", icon: Repeat, hint: "Renewals, duplicates, client plans" },
  { href: "/reports", label: "Reports", icon: ChartNoAxesCombined, hint: "Cash flow, categories, 50/30/20" },
  { href: "/ai", label: "AI spend", icon: Bot, hint: "Usage and reservations" },
  { href: "/my-finances", label: "My finances", icon: PiggyBank, hint: "Income, living, usage, savings and P&L" },
  { href: "/future-projects", label: "Future projects", icon: CalendarRange, hint: "Planned, funded, gap and target date" },
  { href: "/settings", label: "Settings", icon: Settings, hint: "Rates, workspace, security" },
  { href: "/settings#rates", label: "Exchange rates", icon: Landmark, hint: "NBP · ECB · BNR" },
] as const;

export { Plus, Search };
