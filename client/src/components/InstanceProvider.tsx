import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { trpc } from "@/_core/trpc";

/** The instance shape every page reads (never the raw row — the API key is masked). */
export interface InstanceView {
  id: string;
  label: string;
  serverUrl: string;
  apiKeyMasked: string | null;
  phoneNumber: string | null;
  profileName: string | null;
  webhookUrl: string | null;
  webhookFormat: string;
  isDefault: boolean;
  lastStatus: string;
  lastStatusDetail: string | null;
  // superjson revives these on the client, so they really are Dates at runtime —
  // typing them as `string` is what made the router output non-comparable.
  lastCheckedAt: string | Date | null;
  createdAt: string | Date;
}

interface InstanceContextValue {
  instances: InstanceView[];
  selected: InstanceView | null;
  selectInstance: (id: string) => void;
  isLoading: boolean;
  refetch: () => void;
  /** True once we know the account has no instance at all. */
  hasNone: boolean;
}

const STORAGE_KEY = "wame:selected-instance";

const InstanceContext = createContext<InstanceContextValue | null>(null);

/**
 * Tracks which instance the whole panel is acting on. The selection is sticky
 * across visits (localStorage) and self-heals: if the stored id no longer exists
 * — deleted, or another browser's session — it falls back to the first one.
 */
export function InstanceProvider({ children }: { children: ReactNode }) {
  const list = trpc.instances.list.useQuery(undefined, { refetchOnWindowFocus: false });
  // No cast: InstanceView mirrors what router → maskInstance actually returns.
  const instances: InstanceView[] = list.data ?? [];
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(STORAGE_KEY);
  });

  const selected = useMemo(() => {
    if (instances.length === 0) return null;
    const found = instances.find((i) => i.id === selectedId);
    return found ?? instances[0];
  }, [instances, selectedId]);

  // Persist whatever ended up being the effective selection, so the fallback
  // sticks instead of re-resolving on every load.
  useEffect(() => {
    if (!selected) return;
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEY, selected.id);
  }, [selected]);

  const selectInstance = useCallback((id: string) => setSelectedId(id), []);
  const refetch = useCallback(() => {
    void list.refetch();
  }, [list]);

  const value = useMemo<InstanceContextValue>(
    () => ({
      instances,
      selected,
      selectInstance,
      isLoading: list.isLoading,
      refetch,
      hasNone: !list.isLoading && instances.length === 0,
    }),
    [instances, selected, selectInstance, list.isLoading, refetch],
  );

  return <InstanceContext.Provider value={value}>{children}</InstanceContext.Provider>;
}

export function useInstance(): InstanceContextValue {
  const ctx = useContext(InstanceContext);
  if (!ctx) throw new Error("useInstance must be used within <InstanceProvider>");
  return ctx;
}
