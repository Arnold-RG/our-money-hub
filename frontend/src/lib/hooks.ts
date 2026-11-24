"use client";

import useSWR from "swr";
import { useApp, useWsKey } from "@/providers/app-provider";

/** Workspace-scoped query; includes the reporting currency when `lens` is true. */
export function useWs<T>(path: string | null, lens = false) {
  const { currency } = useApp();
  const full = path && lens ? `${path}${path.includes("?") ? "&" : "?"}currency=${currency}` : path;
  return useSWR<T>(useWsKey(full));
}
