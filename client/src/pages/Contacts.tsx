import { useState, type FormEvent } from "react";
import { trpc } from "@/_core/trpc";
import { useInstance } from "@/components/InstanceProvider";
import { PageHeader, StatCard } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/states";
import { formatNumber } from "@shared/wame";
import { formatShortDateTime } from "@/lib/format";
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";

/** The instance address book: synced from WAME, plus numbers added by hand. */
export default function Contacts() {
  const { selected, instances } = useInstance();
  const utils = trpc.useUtils();
  const [search, setSearch] = useState("");
  const [name, setName] = useState("");
  const [number, setNumber] = useState("");

  const list = trpc.contacts.list.useQuery({ q: search.trim() || undefined });
  const count = trpc.contacts.count.useQuery();

  const sync = trpc.contacts.sync.useMutation({
    onSuccess: () => {
      void utils.contacts.list.invalidate();
      void utils.contacts.count.invalidate();
      void utils.dashboard.overview.invalidate();
    },
  });
  const create = trpc.contacts.create.useMutation({
    onSuccess: () => {
      setName("");
      setNumber("");
      void utils.contacts.list.invalidate();
      void utils.contacts.count.invalidate();
      void utils.dashboard.overview.invalidate();
    },
  });
  const remove = trpc.contacts.remove.useMutation({
    onSuccess: () => {
      void utils.contacts.list.invalidate();
      void utils.contacts.count.invalidate();
      void utils.dashboard.overview.invalidate();
    },
  });

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!number.trim()) return;
    create.mutate({
      instanceId: selected?.id,
      number,
      name: name.trim() || undefined,
    });
  }

  const rows = list.data ?? [];
  const searching = search.trim().length > 0;

  return (
    <div className="space-y-7">
      <PageHeader
        title="Contatos"
        description="A base que você usa para segmentar o Status: escolha contatos específicos para uma publicação em vez de mostrar para todos."
        actions={
          <Button
            disabled={!selected || sync.isPending}
            onClick={() => selected && sync.mutate({ instanceId: selected.id })}
          >
            {sync.isPending ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            Sincronizar da WAME
          </Button>
        }
      />

      {!selected && instances.length === 0 && (
        <EmptyState
          icon={Users}
          title="Nenhuma instância configurada"
          body="Os contatos são lidos da sua instância da WAME. Cadastre a chave da API em Configurações para poder sincronizar a lista."
          action={
            <Button asChild>
              <a href="/configuracoes">Ir para Configurações</a>
            </Button>
          }
        />
      )}

      {selected && (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard label="Contatos na lista" value={count.data ?? 0} icon={Users} />
            <StatCard
              label="Fonte"
              value={
                rows.some((r) => r.source === "synced") && rows.some((r) => r.source === "manual")
                  ? "Mista"
                  : rows.some((r) => r.source === "synced")
                    ? "WAME"
                    : "Manual"
              }
              hint="Sincronizados vêm da instância; manuais você digitou"
              icon={RefreshCw}
            />
            <StatCard
              label="Última sincronização"
              value={
                rows.find((r) => r.source === "synced" && r.syncedAt)
                  ? formatShortDateTime(rows.find((r) => r.source === "synced" && r.syncedAt)?.syncedAt ?? null)
                  : "—"
              }
              hint="Atualize sempre que adicionar contatos no celular"
              icon={CheckCircle2}
            />
          </div>

          {sync.isError && <ErrorState title="A sincronização falhou" body={sync.error.message} />}
          {sync.isSuccess && (
            <div className="rounded-xl border border-success/40 bg-success/5 p-4">
              <p className="flex items-center gap-2 text-sm font-semibold text-success">
                <CheckCircle2 className="size-4" />
                {sync.data.received} contato(s) recebido(s) da WAME, {sync.data.written} gravado(s) na sua lista.
              </p>
            </div>
          )}

          <div className="grid gap-5 lg:grid-cols-[1fr_20rem]">
            <div className="space-y-3">
              <Input
                placeholder="Buscar por nome ou número"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Buscar contatos"
              />

              {list.isLoading && (
                <div className="space-y-2">
                  {[0, 1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-14" />
                  ))}
                </div>
              )}

              {list.isError && (
                <ErrorState body="Não foi possível carregar os contatos." onRetry={() => void list.refetch()} />
              )}

              {!list.isLoading && !list.isError && rows.length === 0 && (
                <EmptyState
                  icon={Users}
                  title={searching ? "Nenhum contato encontrado" : "Sua lista está vazia"}
                  body={
                    searching
                      ? "Tente outro nome ou número — a busca cobre nome, número e JID."
                      : "Clique em “Sincronizar da WAME” para trazer os contatos da instância, ou adicione um número manualmente ao lado."
                  }
                  action={
                    !searching ? (
                      <Button
                        variant="outline"
                        disabled={sync.isPending}
                        onClick={() => sync.mutate({ instanceId: selected.id })}
                      >
                        <RefreshCw className="size-4" />
                        Sincronizar agora
                      </Button>
                    ) : undefined
                  }
                />
              )}

              {rows.length > 0 && (
                <ul className="divide-y divide-border/70 overflow-hidden rounded-xl border border-border bg-card/60">
                  {rows.map((c) => (
                    <li key={c.id} className="flex items-center gap-3 px-4 py-3">
                      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                        <Users className="size-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{c.name ?? "Sem nome"}</p>
                        <p className="tabular text-caption text-muted-foreground">
                          {c.number ? formatNumber(c.number) : c.jid.split("@")[0]}
                        </p>
                      </div>
                      <Badge variant={c.source === "synced" ? "default" : "outline"}>
                        {c.source === "synced" ? "WAME" : "Manual"}
                      </Badge>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Remover ${c.name ?? c.jid}`}
                        title="Remover da lista"
                        disabled={remove.isPending}
                        onClick={() => remove.mutate({ id: c.id })}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <aside className="space-y-3 lg:sticky lg:top-24 lg:self-start">
              <form onSubmit={onSubmit} className="panel space-y-4 p-5">
                <div className="space-y-1">
                  <h2>Adicionar contato</h2>
                  <p className="text-caption text-muted-foreground">
                    Útil para números que ainda não estão no aparelho — eles ficam disponíveis como audiência de Status.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="c-number">Número (DDD + número)</Label>
                  <Input
                    id="c-number"
                    inputMode="numeric"
                    placeholder="5511999999999"
                    value={number}
                    onChange={(e) => setNumber(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="c-name">Nome (opcional)</Label>
                  <Input id="c-name" placeholder="Maria — cliente VIP" value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                {create.isError && (
                  <p className={cn("flex items-start gap-2 text-sm", "text-destructive")}>
                    <AlertCircle className="mt-0.5 size-4 shrink-0" />
                    {create.error.message}
                  </p>
                )}
                <Button type="submit" className="w-full" disabled={create.isPending || !number.trim()}>
                  {create.isPending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                  Adicionar
                </Button>
              </form>
            </aside>
          </div>
        </>
      )}
    </div>
  );
}
