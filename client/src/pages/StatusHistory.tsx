import { useMemo, useState } from "react";
import { Link } from "wouter";
import { trpc } from "@/_core/trpc";
import { cn } from "@/lib/utils";
import { PageHeader, StatCard } from "@/components/PageHeader";
import { LiveBadge } from "@/components/ConnectionPill";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/states";
import { formatDateTime, formatShortDateTime, hoursRemaining, relativeTime } from "@/lib/format";
import { STATUS_KIND_META, STATUS_KINDS, type StatusKind } from "@shared/wame";
import { STATUS_LIFETIME_MS } from "@shared/constants";
import {
  AlertCircle,
  AtSign,
  CheckCircle2,
  ChevronDown,
  Film,
  History,
  Image as ImageIcon,
  Loader2,
  Megaphone,
  Music,
  Send,
  Trash2,
  Type,
} from "lucide-react";

const KIND_ICON = { image: ImageIcon, video: Film, text: Type, audio: Music } as const;

/** History of every publication attempt, with the provider's own answer. */
export default function StatusHistory() {
  const [kind, setKind] = useState<StatusKind | "">("");
  const [state, setState] = useState<"published" | "failed" | "">("");
  const utils = trpc.useUtils();

  const list = trpc.status.list.useQuery({
    kind: kind || undefined,
    state: state || undefined,
    limit: 100,
  });
  const stats = trpc.status.stats.useQuery();

  const remove = trpc.status.remove.useMutation({
    onSuccess: () => {
      void utils.status.list.invalidate();
      void utils.status.stats.invalidate();
      void utils.dashboard.overview.invalidate();
    },
  });

  const posts = list.data ?? [];
  const filtersActive = Boolean(kind || state);

  return (
    <div className="space-y-7">
      <PageHeader
        title="Histórico de status"
        description="Tudo o que o painel já publicou, com a resposta que a WAME devolveu — inclusive as falhas."
        actions={
          <Button asChild>
            <Link href="/status">
              <Send className="size-4" />
              Publicar status
            </Link>
          </Button>
        }
      />

      {stats.data && (
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard label="Publicados" value={stats.data.published} icon={CheckCircle2} tone="success" />
          <StatCard
            label="Falhas"
            value={stats.data.failed}
            icon={AlertCircle}
            tone={stats.data.failed > 0 ? "destructive" : "default"}
          />
          <StatCard label="Últimos 7 dias" value={stats.data.last7Days} icon={Megaphone} />
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card/40 p-4">
        <div className="space-y-1.5">
          <label htmlFor="f-kind" className="text-caption text-muted-foreground">
            Tipo
          </label>
          <Select id="f-kind" value={kind} onChange={(e) => setKind(e.target.value as StatusKind | "")} className="w-40">
            <option value="">Todos os tipos</option>
            {STATUS_KINDS.map((k) => (
              <option key={k} value={k}>
                {STATUS_KIND_META[k].label}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="f-state" className="text-caption text-muted-foreground">
            Estado
          </label>
          <Select
            id="f-state"
            value={state}
            onChange={(e) => setState(e.target.value as "published" | "failed" | "")}
            className="w-40"
          >
            <option value="">Todos os estados</option>
            <option value="published">Publicados</option>
            <option value="failed">Falhas</option>
          </Select>
        </div>
        {filtersActive && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setKind("");
              setState("");
            }}
          >
            Limpar filtros
          </Button>
        )}
        <span className="ml-auto text-caption text-muted-foreground">
          {list.isLoading ? "Carregando…" : `${posts.length} registro(s)`}
        </span>
      </div>

      {list.isLoading && (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      )}

      {list.isError && (
        <ErrorState body="Não foi possível carregar o histórico agora." onRetry={() => void list.refetch()} />
      )}

      {!list.isLoading && !list.isError && posts.length === 0 && (
        <EmptyState
          icon={History}
          title={filtersActive ? "Nenhum status com esse filtro" : "Nenhuma publicação ainda"}
          body={
            filtersActive
              ? "Troque o tipo ou o estado para ver outras publicações do seu histórico."
              : "Cada imagem ou vídeo que você enviar para o Status aparece aqui, com o identificador e a resposta da WAME."
          }
          action={
            filtersActive ? (
              <Button
                variant="outline"
                onClick={() => {
                  setKind("");
                  setState("");
                }}
              >
                Limpar filtros
              </Button>
            ) : (
              <Button asChild>
                <Link href="/status">Publicar o primeiro status</Link>
              </Button>
            )
          }
        />
      )}

      {posts.length > 0 && (
        <ul className="space-y-3">
          {posts.map((post) => (
            <PostRow key={post.id} post={post} onDelete={() => remove.mutate({ id: post.id })} deleting={remove.isPending} />
          ))}
        </ul>
      )}
    </div>
  );
}

function PostRow({
  post,
  onDelete,
  deleting,
}: {
  post: {
    id: string;
    kind: string;
    caption: string | null;
    mediaUrl: string | null;
    fileName: string | null;
    audienceMode: string;
    statusJidList: string[] | null;
    state: string;
    providerMessageId: string | null;
    providerResponse: unknown;
    errorMessage: string | null;
    publishedAt: string | Date | null;
    createdAt: string | Date;
  };
  onDelete: () => void;
  deleting: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [mentionNumber, setMentionNumber] = useState("");
  const utils = trpc.useUtils();

  const mention = trpc.status.mention.useMutation({
    onSuccess: () => {
      setMentionNumber("");
      void utils.status.list.invalidate();
    },
  });

  const Icon = KIND_ICON[post.kind as StatusKind] ?? Send;
  const meta = STATUS_KIND_META[post.kind as StatusKind];
  const remaining = hoursRemaining(post.publishedAt, STATUS_LIFETIME_MS);
  const responseText = useMemo(() => {
    if (post.providerResponse === null || post.providerResponse === undefined) return null;
    try {
      return JSON.stringify(post.providerResponse, null, 2);
    } catch {
      return String(post.providerResponse);
    }
  }, [post.providerResponse]);

  return (
    <li className={cn("panel overflow-hidden", post.state === "failed" && "border-destructive/40")}>
      <div className="flex flex-wrap items-start gap-4 p-4">
        <span
          className={cn(
            "grid size-10 shrink-0 place-items-center overflow-hidden rounded-lg",
            post.state === "failed" ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary",
          )}
        >
          {post.kind === "image" && post.mediaUrl ? (
            <img src={post.mediaUrl} alt="" className="size-10 object-cover" />
          ) : (
            <Icon className="size-4" />
          )}
        </span>

        <div className="min-w-0 flex-1 space-y-1.5">
          <p className="truncate text-sm font-medium">
            {post.caption?.trim() || meta?.label || post.kind}
          </p>
          <p className="text-caption text-muted-foreground">
            {meta?.label ?? post.kind} · criado {formatShortDateTime(post.createdAt)}
            {post.publishedAt ? ` · publicado ${relativeTime(post.publishedAt)}` : ""}
          </p>
          <div className="flex flex-wrap items-center gap-2 pt-0.5">
            {post.state === "published" ? <LiveBadge publishedAt={post.publishedAt} /> : <Badge variant="destructive">Falhou</Badge>}
            <Badge variant="outline">
              {post.audienceMode === "all"
                ? "Todos os contatos"
                : `${post.statusJidList?.length ?? 0} contato(s)`}
            </Badge>
            {post.state === "published" && remaining !== null && remaining > 0 && (
              <span className="text-caption text-muted-foreground">expira em {remaining} h</span>
            )}
          </div>
          {post.errorMessage && (
            <p className="flex items-start gap-2 pt-1 text-sm text-destructive">
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              {post.errorMessage}
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
            Detalhes
            <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} />
          </Button>
          {confirming ? (
            <div className="flex items-center gap-1">
              <Button variant="destructive" size="sm" disabled={deleting} onClick={onDelete}>
                {deleting ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                Excluir
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
                Cancelar
              </Button>
            </div>
          ) : (
            <Button
              variant="ghost"
              size="icon"
              aria-label="Excluir registro"
              title="Excluir do histórico"
              onClick={() => setConfirming(true)}
            >
              <Trash2 className="size-4" />
            </Button>
          )}
        </div>
      </div>

      {open && (
        <div className="space-y-4 border-t border-border/70 bg-muted/20 p-4">
          <dl className="grid gap-3 sm:grid-cols-2">
            <Detail label="Criado em" value={formatDateTime(post.createdAt)} />
            <Detail label="Publicado em" value={formatDateTime(post.publishedAt)} />
            <Detail label="ID na WAME" value={post.providerMessageId ?? "não informado pela API"} mono />
            <Detail label="Arquivo" value={post.fileName ?? (post.mediaUrl ? "URL externa" : "—")} />
          </dl>

          {post.mediaUrl && (
            <div className="space-y-1.5">
              <p className="text-subheading text-muted-foreground">Mídia usada</p>
              <a
                href={post.mediaUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="focus-ring block break-all rounded font-mono text-caption text-primary hover:underline"
              >
                {post.mediaUrl}
              </a>
            </div>
          )}

          {responseText && (
            <div className="space-y-1.5">
              <p className="text-subheading text-muted-foreground">Resposta da WAME</p>
              <pre className="max-h-64 overflow-auto rounded-lg border border-border bg-background/80 p-3 font-mono text-[11px] leading-relaxed text-muted-foreground">
                {responseText}
              </pre>
            </div>
          )}

          {post.state === "published" && post.providerMessageId && (
            <div className="space-y-2 rounded-lg border border-border bg-card/60 p-3">
              <p className="text-subheading text-muted-foreground">Mencionar um contato</p>
              <p className="text-caption text-muted-foreground">
                O contato recebe o aviso de que foi mencionado neste status. Use com parcimônia — menção é
                notificação.
              </p>
              <div className="flex flex-wrap gap-2">
                <Input
                  className="max-w-56"
                  inputMode="numeric"
                  placeholder="5511999999999"
                  value={mentionNumber}
                  onChange={(e) => setMentionNumber(e.target.value)}
                  aria-label="Número para mencionar"
                />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={mention.isPending || mentionNumber.trim().length < 8}
                  onClick={() => mention.mutate({ id: post.id, number: mentionNumber })}
                >
                  {mention.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <AtSign className="size-3.5" />}
                  Mencionar
                </Button>
              </div>
              {mention.isError && <p className="text-caption text-destructive">{mention.error.message}</p>}
              {mention.isSuccess && <p className="text-caption text-success">Menção enviada.</p>}
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function Detail({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-caption text-muted-foreground">{label}</dt>
      <dd className={cn("text-sm", mono && "break-all font-mono text-caption")}>{value}</dd>
    </div>
  );
}
