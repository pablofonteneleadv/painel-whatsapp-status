// Display formatting shared by every page. Kept out of components so a date or
// byte size reads identically everywhere in the panel.

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Short form for dense lists: "15/10, 14:06". */
export function formatShortDateTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** "há 3 min", "há 2 h", "há 4 dias" — for recency, where a clock time is noise. */
export function relativeTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  const seconds = Math.round((Date.now() - d.getTime()) / 1000);
  if (seconds < 45) return "agora";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  const days = Math.round(hours / 24);
  if (days < 30) return `há ${days} ${days === 1 ? "dia" : "dias"}`;
  return formatShortDateTime(d);
}

/** True while a published status is still inside its 24-hour live window. */
export function isLiveWindow(publishedAt: string | Date | null | undefined, windowMs: number): boolean {
  if (!publishedAt) return false;
  const d = typeof publishedAt === "string" ? new Date(publishedAt) : publishedAt;
  if (Number.isNaN(d.getTime())) return false;
  return Date.now() - d.getTime() < windowMs;
}

/** Hours remaining in the live window, floored at zero. */
export function hoursRemaining(publishedAt: string | Date | null | undefined, windowMs: number): number | null {
  if (!publishedAt) return null;
  const d = typeof publishedAt === "string" ? new Date(publishedAt) : publishedAt;
  if (Number.isNaN(d.getTime())) return null;
  return Math.max(0, Math.floor((windowMs - (Date.now() - d.getTime())) / 3_600_000));
}

export function formatBytes(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let n = value;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${n < 10 && i > 0 ? n.toFixed(1) : Math.round(n)} ${units[i]}`;
}
