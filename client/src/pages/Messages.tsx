import { useState, type FormEvent } from "react";
import { trpc } from "@/_core/trpc";
import { useInstance } from "@/components/InstanceProvider";
import { PageHeader, StatCard } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/states";
import { formatNumber } from "@shared/wame";
import { formatShortDateTime } from "@/lib/format";
import {
  AlertCircle,
  CheckCircle2,
  Image as ImageIcon,
  Loader2,
  MessageSquare,
  Send,
  Trash2,
  Type,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Direct messages through the instance. Secondary to Status, but part of the
 * same operator surface: a message a customer asked for in the DM.
 */
export default function Messages() {
  const { selected, instances } = useInstance();
  const utils = trpc.useUtils();
  const [kind, setKind] = useState<"text" | "image">("text");
  const [to, setTo] = useState("");
  const [body, setBody] = useState("");
  const [mediaUrl, setMediaUrl] = useState("");
  const [uploading, setUploading] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const logs = trpc.messages.list.useQuery();
  const getUploadUrl = trpc.media.uploadUrl.useMutation();
  const commitUpload = trpc.media.commit.useMutation();

  const send = trpc.messages.send.useMutation({
    onSuccess: () => {
      setBody("");
      setMediaUrl("");
      void utils.messages.list.invalidate();
      void utils.media.list.invalidate();
    },
  });
  const remove = trpc.messages.remove.useMutation({
    onSuccess: () => void utils.messages.list.invalidate(),
  });

  async function onPickFile(file: File) {
    setUploadError(null);
    try {
      setUploading("Enviando a imagem…");
      const { uploadMedia } = await import("@/lib/upload");
      const result = await uploadMedia(file, "image", {
        getUploadUrl: (input) => getUploadUrl.mutateAsync(input),
        commit: (input) => commitUpload.mutateAsync(input),
      });
      setMediaUrl(result.publicUrl);
      void utils.media.list.invalidate();
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "Falha ao enviar a imagem.");
    } finally {
      setUploading(null);
    }
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selected) return;
    send.mutate({
      instanceId: selected.id,
      to,
      kind,
      text: kind === "text" ? body : undefined,
      mediaUrl: kind === "image" ? mediaUrl : undefined,
      caption: kind === "image" ? body.trim() || undefined : undefined,
    });
  }

  const rows = logs.data ?? [];
  const canSend =
    Boolean(selected) &&
    to.trim().length >= 8 &&
    (kind === "text" ? body.trim().length > 0 : mediaUrl.trim().length > 0) &&
    !send.isPending &&
    !uploading;

  return (
    <div className="space-y-7">
      <PageHeader
        title="Mensagens"
        description="Envie um texto ou uma imagem direto para o WhatsApp de um cliente, e acompanhe o que já saiu."
      />

      {instances.length === 0 ? (
        <EmptyState
          icon={MessageSquare}
          title="Nenhuma instância configurada"
          body="As mensagens saem pela sua instância da WAME. Cadastre a chave da API em Configurações para começar."
          action={
            <Button asChild>
              <a href="/configuracoes">Ir para Configurações</a>
            </Button>
          }
        />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[1fr_1.2fr]">
          <form onSubmit={onSubmit} className="panel space-y-4 p-5 lg:sticky lg:top-24 lg:self-start">
            <div className="space-y-1">
              <h2>Nova mensagem</h2>
              <p className="text-caption text-muted-foreground">
                Sai pela instância <span className="font-medium text-foreground">{selected?.label}</span>.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Tipo de mensagem">
              {(
                [
                  { value: "text", label: "Texto", icon: Type },
                  { value: "image", label: "Imagem", icon: ImageIcon },
                ] as const
              ).map((option) => {
                const Icon = option.icon;
                const active = kind === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => {
                      setKind(option.value);
                      send.reset();
                    }}
                    className={cn(
                      "focus-ring flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors",
                      active
                        ? "border-primary/60 bg-primary/10 text-foreground"
                        : "border-border bg-card/50 text-muted-foreground hover:bg-accent/40",
                    )}
                  >
                    <Icon className={cn("size-4", active && "text-primary")} />
                    {option.label}
                  </button>
                );
              })}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="m-to">Número de destino</Label>
              <Input
                id="m-to"
                inputMode="numeric"
                placeholder="5511999999999"
                value={to}
                onChange={(e) => {
                  setTo(e.target.value);
                  send.reset();
                }}
                required
              />
              <p className="text-caption text-muted-foreground">DDD + número, com o código do país.</p>
            </div>

            {kind === "image" && (
              <div className="space-y-2">
                <Label htmlFor="m-media">Imagem</Label>
                <Input
                  id="m-media"
                  type="file"
                  accept=".jpg,.jpeg,.png,.webp,.gif,.avif"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void onPickFile(file);
                  }}
                />
                {uploading && (
                  <p className="flex items-center gap-2 text-caption text-muted-foreground">
                    <Loader2 className="size-3.5 animate-spin" />
                    {uploading}
                  </p>
                )}
                {mediaUrl && (
                  <img src={mediaUrl} alt="Imagem escolhida" className="max-h-40 rounded-lg border border-border object-contain" />
                )}
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="m-body">{kind === "text" ? "Mensagem" : "Legenda (opcional)"}</Label>
              <Textarea
                id="m-body"
                value={body}
                onChange={(e) => {
                  setBody(e.target.value);
                  send.reset();
                }}
                maxLength={4000}
                placeholder={kind === "text" ? "Olá! Seu pedido saiu para entrega." : "Legenda que acompanha a imagem"}
              />
            </div>

            {uploadError && (
              <p className="flex items-start gap-2 text-sm text-destructive">
                <AlertCircle className="mt-0.5 size-4 shrink-0" />
                {uploadError}
              </p>
            )}

            <Button type="submit" className="w-full" disabled={!canSend}>
              {send.isPending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              {send.isPending ? "Enviando…" : "Enviar mensagem"}
            </Button>

            {send.isError && <ErrorState title="A mensagem não foi enviada" body={send.error.message} />}
            {send.isSuccess && (
              <p className="flex items-center gap-2 text-sm text-success">
                <CheckCircle2 className="size-4" />
                Mensagem enviada.
              </p>
            )}
          </form>

          <div className="space-y-3">
            <div className="grid gap-4 sm:grid-cols-2">
              <StatCard label="Mensagens enviadas" value={rows.filter((r) => r.state === "sent").length} icon={Send} />
              <StatCard
                label="Falhas"
                value={rows.filter((r) => r.state === "failed").length}
                icon={AlertCircle}
                tone={rows.some((r) => r.state === "failed") ? "destructive" : "default"}
              />
            </div>

            {logs.isLoading && (
              <div className="space-y-2">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-16" />
                ))}
              </div>
            )}
            {logs.isError && <ErrorState body="Não foi possível carregar as mensagens." onRetry={() => void logs.refetch()} />}

            {!logs.isLoading && !logs.isError && rows.length === 0 && (
              <EmptyState
                icon={MessageSquare}
                title="Nenhuma mensagem enviada"
                body="As mensagens que você enviar pelo painel ficam registradas aqui, com o horário e o estado que a WAME devolveu."
              />
            )}

            {rows.length > 0 && (
              <ul className="divide-y divide-border/70 overflow-hidden rounded-xl border border-border bg-card/60">
                {rows.map((log) => (
                  <li key={log.id} className="flex items-start gap-3 px-4 py-3">
                    <span
                      className={cn(
                        "grid size-9 shrink-0 place-items-center rounded-lg",
                        log.state === "failed" ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary",
                      )}
                    >
                      {log.kind === "image" ? <ImageIcon className="size-4" /> : <Type className="size-4" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">{log.body?.trim() || (log.kind === "image" ? "Imagem" : "—")}</p>
                      <p className="tabular text-caption text-muted-foreground">
                        {formatNumber(log.to)} · {formatShortDateTime(log.createdAt)}
                      </p>
                      {log.errorMessage && <p className="pt-1 text-caption text-destructive">{log.errorMessage}</p>}
                    </div>
                    <Badge variant={log.state === "failed" ? "destructive" : "success"}>
                      {log.state === "failed" ? "Falhou" : "Enviada"}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Excluir registro"
                      disabled={remove.isPending}
                      onClick={() => remove.mutate({ id: log.id })}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
