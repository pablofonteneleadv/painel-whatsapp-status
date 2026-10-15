import { cn } from "@/lib/utils";

/** Shared loading block — a designed loading state, not a bare "Loading…". */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-md bg-muted/70", className)} />;
}

/**
 * The empty state every list and dashboard renders instead of a blank panel:
 * what the view is, why it is empty, and the action that fills it.
 */
export function EmptyState({
  icon: Icon,
  title,
  body,
  action,
  className,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  body: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border/80 bg-card/40 px-6 py-14 text-center",
        className,
      )}
    >
      {Icon && (
        <span className="grid size-12 place-items-center rounded-full bg-primary/10 text-primary">
          <Icon className="size-6" />
        </span>
      )}
      <p className="text-heading">{title}</p>
      <p className="max-w-md text-sm leading-relaxed text-muted-foreground">{body}</p>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

/** Inline error surface with a retry hook. */
export function ErrorState({
  title = "Não foi possível carregar",
  body,
  onRetry,
}: {
  title?: string;
  body?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-5">
      <p className="text-sm font-semibold text-destructive">{title}</p>
      {body && <p className="mt-1 text-sm text-muted-foreground">{body}</p>}
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="focus-ring mt-3 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent"
        >
          Tentar de novo
        </button>
      )}
    </div>
  );
}
