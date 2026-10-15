import { Link } from "wouter";
import { trpc } from "@/_core/trpc";
import { useInstance } from "@/components/InstanceProvider";
import { PageHeader, Section, StatCard } from "@/components/PageHeader";
import { LiveBadge } from "@/components/ConnectionPill";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/states";
import { formatShortDateTime, relativeTime } from "@/lib/format";
import { STATUS_KIND_META, connectionLabel, type ConnectionState, type StatusKind } from "@shared/wame";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Film,
  Image as ImageIcon,
  Megaphone,
  Music,
  Send,
  Type,
  Users,
} from "lucide-react";

const KIND_ICON = {
  image: ImageIcon,
  video: Film,
  text: Type,
  audio: Music,
} as const;

/** Overview: connection state, counters, and the most recent publications. */
export default function Home() {
  const overview = trpc.dashboard.overview.useQuery();
  const { selected, instances } = useInstance();

  if (overview.isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Visão geral" description="Carregando o estado da sua operação…" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
        <Skeleton className="h-56" />
      </div>
    );
  }

  if (overview.isError) {
    return (
      <div className="space-y-6">
        <PageHeader title="Visão geral" />
        <ErrorState
          body="O painel não conseguiu carregar seus dados agora. Tente novamente."
          onRetry={() => void overview.refetch()}
        />
      </div>
    );
  }

  // `isLoading` / `isError` are SIBLING flags on the query result, so TypeScript
  // does not narrow `data` from them — this guard is what makes every read below
  // total instead of `possibly undefined`.
  if (!overview.data) {
    return (
      <div className="space-y-6">
        <PageHeader title="Visão geral" />
        <ErrorState
          body="O painel não conseguiu carregar seus dados agora. Tente novamente."
          onRetry={() => void overview.refetch()}
        />
      </div>
    );
  }

  const data = overview.data;
  if (!data) return null;
  const stats = data.stats;
  const state = (selected?.lastStatus ?? "unknown") as ConnectionState;
  const kindRows = Object.entries(stats.byKind).sort((a, b) => b[1] - a[1]);
  const maxKind = Math.max(1, ...kindRows.map(([, v]) => v));

  return (
    <div className="space-y-7">
      <PageHeader
        title="Visão geral"
        description="Publique imagens e vídeos em Status, escolha quem vê e acompanhe tudo o que já saiu."
        actions={
          <>
            <Button asChild>
              <Link href="/status">
                <Send className="size-4" />
                Publicar status
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/historico">Ver histórico</Link>
            </Button>
          </>
        }
      />

      {instances.length === 0 ? (
        <EmptyState
          icon={Megaphone}
          title="Conecte sua instância da WAME"
          body="O painel publica status e envia mensagens através da sua instância. Cole a chave da API em Configurações — ela fica guardada no servidor e nunca é exposta no navegador."
          action={
            <Button asChild>
              <Link href="/configuracoes">
                Configurar instância
                <ArrowRight className="size-4" />
              </Link>
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Publicados"
            value={stats.published}
            hint="Status que a WAME aceitou"
            icon={CheckCircle2}
            tone="success"
          />
          <StatCard
            label="Falhas"
            value={stats.failed}
            hint={stats.failed > 0 ? "Abra o histórico para ver o motivo" : "Nenhuma falha registrada"}
            icon={AlertCircle}
            tone={stats.failed > 0 ? "destructive" : "default"}
          />
          <StatCard label="Últimos 7 dias" value={stats.last7Days} hint="Publicações na semana" icon={Megaphone} />
          <StatCard label="Contatos" value={data.contactCount} hint="Disponíveis para segmentar" icon={Users} />
        </div>
      )}

      {selected && (
        <Section title="Conexão da instância">
          <div className="panel grid gap-5 p-5 sm:grid-cols-[1.4fr_1fr]">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  variant={
                    state === "connected"
                      ? "success"
                      : state === "qr"
                        ? "warning"
                        : state === "unknown"
                          ? "outline"
                          : "destructive"
                  }
                >
                  {connectionLabel(state)}
                </Badge>
                <span className="text-caption text-muted-foreground">
                  {selected.lastCheckedAt
                    ? `verificado ${relativeTime(selected.lastCheckedAt)}`
                    : "ainda não verificado"}
                </span>
              </div>
              <div className="space-y-1">
                <p className="text-subheading text-muted-foreground">Instância</p>
                <p className="text-sm font-medium">{selected.label}</p>
                <p className="font-mono text-caption text-muted-foreground">{selected.serverUrl}</p>
              </div>
              {selected.lastStatusDetail && (
                <p className="text-caption text-muted-foreground">
                  Resposta da WAME: <span className="font-mono">{selected.lastStatusDetail}</span>
                </p>
              )}
            </div>
            <div className="flex flex-col justify-between gap-3 sm:items-end">
              <div className="space-y-1 sm:text-right">
                <p className="text-subheading text-muted-foreground">Chave da API</p>
                <p className="font-mono text-sm">{selected.apiKeyMasked ?? "—"}</p>
                <p className="text-caption text-muted-foreground">Guardada no servidor, mascarada aqui</p>
              </div>
              <Button asChild variant="outline" size="sm">
                <Link href="/configuracoes">Gerir instância</Link>
              </Button>
            </div>
          </div>
        </Section>
      )}

      <div className="grid gap-5 lg:grid-cols-[1.5fr_1fr]">
        <Section
          title="Últimas publicações"
          action={
            stats.total > 0 ? (
              <Link href="/historico" className="focus-ring rounded text-caption text-primary hover:underline">
                Ver todas
              </Link>
            ) : null
          }
        >
          {data.recent.length === 0 ? (
            <EmptyState
              icon={Send}
              title="Nenhum status publicado ainda"
              body="Quando você publicar a primeira imagem ou vídeo, ele aparece aqui com o estado que a WAME devolveu."
              action={
                <Button asChild size="sm">
                  <Link href="/status">Criar o primeiro status</Link>
                </Button>
              }
            />
          ) : (
            <ul className="divide-y divide-border/70 overflow-hidden rounded-xl border border-border bg-card/60">
              {data.recent.map((post) => {
                const Icon = KIND_ICON[post.kind as StatusKind] ?? Send;
                return (
                  <li key={post.id} className="flex items-center gap-4 px-4 py-3.5">
                    <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                      <Icon className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {post.caption?.trim() || STATUS_KIND_META[post.kind as StatusKind]?.label || post.kind}
                      </p>
                      <p className="text-caption text-muted-foreground">
                        {STATUS_KIND_META[post.kind as StatusKind]?.label ?? post.kind} ·{" "}
                        {formatShortDateTime(post.publishedAt ?? post.createdAt)} ·{" "}
                        {post.audienceMode === "all" ? "todos os contatos" : "lista selecionada"}
                      </p>
                    </div>
                    {post.state === "published" ? <LiveBadge publishedAt={post.publishedAt} /> : (
                      <Badge variant="destructive">Falhou</Badge>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Section>

        <Section title="Distribuição por tipo">
          {kindRows.length === 0 ? (
            <div className="panel p-5">
              <p className="text-sm text-muted-foreground">
                Sem dados ainda. A distribuição aparece depois da primeira publicação.
              </p>
            </div>
          ) : (
            <div className="panel space-y-4 p-5">
              {kindRows.map(([kind, value]) => {
                const Icon = KIND_ICON[kind as StatusKind] ?? Send;
                return (
                  <div key={kind} className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-2">
                        <Icon className="size-4 text-muted-foreground" />
                        {STATUS_KIND_META[kind as StatusKind]?.label ?? kind}
                      </span>
                      <span className="tabular font-medium">{value}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: `${Math.max(6, (value / maxKind) * 100)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}
