"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import useSWR, { SWRConfig, mutate as globalMutate } from "swr";
import { useRouter, usePathname } from "next/navigation";
import { api, ApiError, setWorkspace, type Me, type Workspace } from "@/lib/api";
import type { Currency } from "@/lib/money";

type Theme = "dark" | "light";

interface Ctx {
  me: Me | null;
  loading: boolean;
  workspace: Workspace | null;
  setWorkspaceId: (id: string) => void;
  currency: Currency;
  setCurrency: (c: Currency) => void;
  theme: Theme;
  toggleTheme: () => void;
  refreshMe: () => Promise<unknown>;
  signOut: () => Promise<void>;
  paletteOpen: boolean;
  setPaletteOpen: (v: boolean) => void;
}

const AppCtx = createContext<Ctx | null>(null);

export function useApp() {
  const c = useContext(AppCtx);
  if (!c) throw new Error("useApp outside AppProvider");
  return c;
}

/** SWR key helper: refetches automatically when the workspace changes. */
export function useWsKey(path: string | null) {
  const { workspace } = useApp();
  return path && workspace ? [path, workspace.id] : null;
}

const wsFetcher = ([path, ws]: [string, string]) => api(path, { headers: { "X-Workspace-Id": ws } });

export function AppProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { data: me, error, isLoading, mutate } = useSWR<Me>("/auth/me", (p: string) => api<Me>(p), {
    shouldRetryOnError: false,
    revalidateOnFocus: false,
  });
  const [wsId, setWsId] = useState<string | null>(null);
  const [currencyOverride, setCurrencyOverride] = useState<Currency | null>(null);
  const [theme, setTheme] = useState<Theme>("dark");
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    const t = (document.documentElement.dataset.theme as Theme) || "dark";
    setTheme(t);
    setWsId(localStorage.getItem("omh.ws"));
  }, []);

  const workspace = useMemo(() => {
    if (!me) return null;
    return me.workspaces.find((w) => w.id === wsId) ?? me.workspaces[0] ?? null;
  }, [me, wsId]);

  useEffect(() => {
    setWorkspace(workspace?.id ?? null);
  }, [workspace]);

  const unauth = error instanceof ApiError && error.status === 401;
  useEffect(() => {
    if (unauth && pathname !== "/login") router.replace("/login");
  }, [unauth, pathname, router]);

  const setWorkspaceId = useCallback((id: string) => {
    localStorage.setItem("omh.ws", id);
    setWsId(id);
  }, []);

  const setCurrency = useCallback(
    (c: Currency) => {
      setCurrencyOverride(c);
      api("/auth/me", { method: "PATCH", json: { reporting_currency: c } }).then(() => mutate()).catch(() => {});
    },
    [mutate],
  );

  const toggleTheme = useCallback(() => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    localStorage.setItem("omh.theme", next);
    setTheme(next);
  }, [theme]);

  const signOut = useCallback(async () => {
    await api("/auth/logout", { method: "POST" }).catch(() => {});
    localStorage.removeItem("omh.ws");
    await globalMutate(() => true, undefined, { revalidate: false });
    router.replace("/login");
  }, [router]);

  const value: Ctx = {
    me: me ?? null,
    loading: isLoading,
    workspace,
    setWorkspaceId,
    currency: currencyOverride ?? me?.reporting_currency ?? "PLN",
    setCurrency,
    theme,
    toggleTheme,
    refreshMe: mutate,
    signOut,
    paletteOpen,
    setPaletteOpen,
  };

  return (
    <SWRConfig value={{ fetcher: wsFetcher as never, revalidateOnFocus: false, keepPreviousData: true }}>
      <AppCtx.Provider value={value}>{children}</AppCtx.Provider>
    </SWRConfig>
  );
}

/** Revalidate every cached query for the current workspace (after a write). */
export function refreshAll() {
  return globalMutate((key) => Array.isArray(key) || key === "/auth/me");
}
