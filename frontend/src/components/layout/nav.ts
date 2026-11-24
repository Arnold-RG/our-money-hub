import { ArrowLeftRight, Bot, ChartNoAxesCombined, Gauge, LayoutDashboard, Landmark, MoreHorizontal, Repeat, Settings, Wallet } from "lucide-react";

export const NAV = [
  { href: "/dashboard", label: "Home", icon: LayoutDashboard },
  { href: "/accounts", label: "Accounts", icon: Wallet },
  { href: "/transactions", label: "Payments", icon: ArrowLeftRight },
  { href: "/budgets", label: "Budgets", icon: Gauge },
  { href: "/subscriptions", label: "Subscriptions", icon: Repeat },
  { href: "/ai", label: "AI spend", icon: Bot },
  { href: "/reports", label: "Reports", icon: ChartNoAxesCombined },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

// Spec §12 mobile dock: Home · Budget · Payments · AI · More
export const DOCK = [
  { href: "/dashboard", label: "Home", icon: LayoutDashboard },
  { href: "/budgets", label: "Budget", icon: Gauge },
  { href: "/transactions", label: "Payments", icon: ArrowLeftRight },
  { href: "/ai", label: "AI", icon: Bot },
  { href: "/more", label: "More", icon: MoreHorizontal },
] as const;

export const MORE = [
  { href: "/accounts", label: "Accounts", icon: Wallet, hint: "Banks, MoMo, cash, IKE/IKZE" },
  { href: "/subscriptions", label: "Subscriptions", icon: Repeat, hint: "Renewals, duplicates, client plans" },
  { href: "/reports", label: "Reports", icon: ChartNoAxesCombined, hint: "Cash flow, categories, 50/30/20" },
  { href: "/settings", label: "Settings", icon: Settings, hint: "Rates, workspace, security" },
  { href: "/settings#rates", label: "Exchange rates", icon: Landmark, hint: "NBP · ECB · BNR" },
] as const;
