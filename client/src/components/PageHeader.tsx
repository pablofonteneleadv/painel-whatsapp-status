import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between", className)}>
      <div className="space-y-1.5">
        <h1>{title}</h1>
        {description && <p className="max-w-2xl text-body text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/** A single number with its label and a hint about what it counts. */
export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "default",
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon?: React.ComponentType<{ className?: string }>;
  tone?: "default" | "success" | "destructive" | "warning";
}) {
  const toneClass =
    tone === "success"
      ? "text-success"
      : tone === "destructive"
        ? "text-destructive"
        : tone === "warning"
          ? "text-warning"
          : "text-foreground";

  return (
    <div className="panel p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-caption font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
        {Icon && (
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
            <Icon className="size-4" />
          </span>
        )}
      </div>
      <p className={cn("tabular mt-3 text-3xl font-semibold tracking-tight", toneClass)}>{value}</p>
      {hint && <p className="mt-1.5 text-caption text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** Small section wrapper so pages share one vertical rhythm. */
export function Section({
  title,
  action,
  children,
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      {(title || action) && (
        <div className="flex items-center justify-between gap-3">
          {title && <h2>{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
