import { cn } from "@/lib/utils";
import { STATUS_LIFETIME_MS } from "@shared/constants";
import { connectionLabel, type ConnectionState } from "@shared/wame";
import { isLiveWindow, relativeTime } from "@/lib/format";
import { useInstance } from "./InstanceProvider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import { trpc } from "@/_core/trpc";
import { useEffect, useRef } from "react";

const TONE: Record<ConnectionState, string> = {
  connected: "bg-success",
  disconnected: "bg-destructive",
  qr: "bg-warning",
  error: "bg-destructive",
  unknown: "bg-muted-foreground",
};

const VARIANT: Record<ConnectionState, "success" | "destructive" | "warning" | "outline"> = {
  connected: "success",
  disconnected: "destructive",
  qr: "warning",
  error: "destructive",
  unknown: "outline",
};

/**
 * Connection state of the instance the whole panel is acting on.
 *
 * The cached state from the database renders immediately; a real check runs
 * once per session per instance (or when the cache is over ten minutes old),
 * because /instance/health is a live call and the topbar is on every page.
 */
export function ConnectionPill() {
  const { selected, refetch } = useInstance();
  const utils = trpc.useUtils();
  const checked = useRef<string | null>(null);

  const health = trpc.instances.health.useMutation({
    onSuccess: () => {
      void refetch();
      void utils.instances.list.invalidate();
    },
  });

  const state = (selected?.lastStatus ?? "unknown") as ConnectionState;

  useEffect(() => {
    if (!selected) return;
    if (checked.current === selected.id) return;
    const stale =
      !selected.lastCheckedAt ||
      Date.now() - new Date(selected.lastCheckedAt).getTime() > 10 * 60 * 1000;
    if (!stale) return;
    checked.current = selected.id;
    health.mutate({ id: selected.id });
    // health.mutate is stable for the lifetime of the mutation observer
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id, selected?.lastCheckedAt]);

  if (!selected) {
    return (
      <Badge variant="outline" className="gap-2">
        <span className={cn("size-2 rounded-full", TONE.unknown)} />
        Sem instância
      </Badge>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Badge variant={VARIANT[state]} className="gap-2 py-1" title={selected.lastStatusDetail ?? undefined}>
        <span
          className={cn(
            "size-2 rounded-full",
            TONE[state],
            state === "connected" && "live-dot",
          )}
        />
        {health.isPending ? "Verificando…" : connectionLabel(state)}
      </Badge>
      <span className="hidden text-caption text-muted-foreground lg:inline">
        {selected.lastCheckedAt ? relativeTime(selected.lastCheckedAt) : "nunca verificado"}
      </span>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Verificar conexão"
        title="Verificar conexão"
        disabled={health.isPending}
        onClick={() => health.mutate({ id: selected.id })}
      >
        <RefreshCw className={cn("size-4", health.isPending && "animate-spin")} />
      </Button>
    </div>
  );
}

/** Compact live/hours badge for one status publication. */
export function LiveBadge({ publishedAt }: { publishedAt: string | Date | null | undefined }) {
  const live = isLiveWindow(publishedAt, STATUS_LIFETIME_MS);
  return (
    <Badge variant={live ? "success" : "outline"}>
      {live ? "Ao vivo" : "Expirado"}
    </Badge>
  );
}
