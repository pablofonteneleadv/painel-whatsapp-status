import { useMemo, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { Link } from "wouter";
import { trpc } from "@/_core/trpc";
import { cn } from "@/lib/utils";
import { useInstance } from "@/components/InstanceProvider";
import { PageHeader, Section } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { formatBytes, formatDateTime } from "@/lib/format";
import { UPLOAD_PHASE_LABEL, uploadMedia, type UploadKind } from "@/lib/upload";
import {
  CAPTION_MAX,
  STATUS_KIND_META,
  STATUS_KINDS,
  UPLOAD_ACCEPT_BY_KIND,
  kindForMime,
  normalizeJid,
  type StatusKind,
} from "@shared/wame";
import {
  AlertCircle,
  CheckCircle2,
  Film,
  Image as ImageIcon,
  Link2,
  Loader2,
  Megaphone,
  Music,
  Send,
  Type,
  Upload,
  Users,
  X,
} from "lucide-react";

const KIND_ICON = { image: ImageIcon, video: Film, text: Type, audio: Music } as const;

interface DraftMedia {
  url: string;
  name: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
}

/**
 * The Status composer. This is the app's core screen: pick image/video (or
 * text/audio), add a caption, choose who can see it, publish through the WAME
 * API, and see exactly what the provider answered.
 */
export default function StatusComposer() {
  const { selected, instances } = useInstance();
  const utils = trpc.useUtils();

  const [kind, setKind] = useState<StatusKind>("image");
  const [media, setMedia] = useState<DraftMedia | null>(null);
  const [externalUrl, setExternalUrl] = useState("");
  const [caption, setCaption] = useState("");
  const [audienceMode, setAudienceMode] = useState<"all" | "list">("all");
  const [pickedIds, setPickedIds] = useState<string[]>([]);
  const [extraNumber, setExtraNumber] = useState("");
  const [extraJids, setExtraJids] = useState<string[]>([]);
  const [uploading, setUploading] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const publish = trpc.status.publish.useMutation({
    onSuccess: () => {
      void utils.status.list.invalidate();
      void utils.status.stats.invalidate();
      void utils.dashboard.overview.invalidate();
      void utils.media.list.invalidate();
    },
  });

  const getUploadUrl = trpc.media.uploadUrl.useMutation();
  const commitUpload = trpc.media.commit.useMutation();
  const assets = trpc.media.list.useQuery();

  const effectiveUrl = media?.url ?? externalUrl.trim();
  const kindAssets = useMemo(
    () => (assets.data ?? []).filter((a) => a.kind === kind).slice(0, 8),
    [assets.data, kind],
  );

  function resetResult() {
    publish.reset();
  }

  function switchKind(next: StatusKind) {
    setKind(next);
    setMedia(null);
    setUploadError(null);
    resetResult();
  }

  async function handleFile(file: File) {
    setUploadError(null);
    resetResult();
    const detected = file.type ? kindForMime(file.type) : kindForMime(`x/${file.name.split(".").pop() ?? ""}`);
    if (!detected) {
      setUploadError(
        "Formato não suportado. Aceitos: JPG, PNG, WEBP, GIF, AVIF, MP4, WEBM, MP3 e WAV.",
      );
      return;
    }
    const uploadKind = detected as UploadKind;
    if (uploadKind !== kind) {
      setKind(uploadKind);
    }
    try {
      const result = await uploadMedia(file, uploadKind, {
        getUploadUrl: (input) => getUploadUrl.mutateAsync(input),
        commit: (input) => commitUpload.mutateAsync(input),
        onProgress: (phase) => setUploading(UPLOAD_PHASE_LABEL[phase]),
      });
      setMedia({
        url: result.publicUrl,
        name: result.name,
        mimeType: file.type || null,
        sizeBytes: file.size,
      });
      setExternalUrl("");
      void utils.media.list.invalidate();
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "Falha ao enviar o arquivo.");
    } finally {
      setUploading(null);
    }
  }

  function onFileInput(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) void handleFile(file);
    e.target.value = "";
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  }

  function addExtraNumber() {
    const jid = normalizeJid(extraNumber);
    if (!jid) {
      setUploadError("Número inválido — use DDD + número, ex.: 5511999999999.");
      return;
    }
    setUploadError(null);
    setExtraJids((prev) => (prev.includes(jid) ? prev : [...prev, jid]));
    setExtraNumber("");
  }

  const validation = (() => {
    if (kind === "text" && !caption.trim()) return "Escreva o texto do status.";
    // An audio status carries no caption, so only the media matters.
    if (kind !== "text" && !effectiveUrl) return "Envie a mídia ou informe uma URL pública.";
    if (audienceMode === "list" && pickedIds.length === 0 && extraJids.length === 0) {
      return "Escolha pelo menos um contato, ou publique para todos.";
    }
    return null;
  })();

  const canPublish = Boolean(selected) && !validation && !publish.isPending && !uploading;

  if (instances.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Publicar status"
          description="Envie uma imagem ou um vídeo com legenda para o Status do WhatsApp."
        />
        <EmptyState
          icon={Megaphone}
          title="Configure uma instância para publicar"
          body="Toda publicação sai pela sua instância da WAME. Cadastre a chave da API em Configurações e volte aqui — leva menos de um minuto."
          action={
            <Button asChild>
              <Link href="/configuracoes">Configurar instância</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const result = publish.data;

  return (
    <div className="space-y-7">
      <PageHeader
        title="Publicar status"
        description="Escolha a mídia, escreva a legenda e defina quem pode ver. A publicação vai direto para a sua instância."
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/historico">Histórico</Link>
          </Button>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[1.35fr_1fr]">
        <div className="space-y-5">
          {/* Kind */}
          <Section title="Tipo de status">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="tablist" aria-label="Tipo de status">
              {STATUS_KINDS.map((k) => {
                const Icon = KIND_ICON[k];
                const active = k === kind;
                return (
                  <button
                    key={k}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => switchKind(k)}
                    className={cn(
                      "focus-ring flex flex-col items-start gap-2 rounded-xl border p-3.5 text-left transition-colors",
                      active
                        ? "border-primary/60 bg-primary/10 text-foreground"
                        : "border-border bg-card/50 text-muted-foreground hover:border-primary/30 hover:bg-accent/40",
                    )}
                  >
                    <Icon className={cn("size-4", active && "text-primary")} />
                    <span className="text-sm font-medium">{STATUS_KIND_META[k].label}</span>
                  </button>
                );
              })}
            </div>
            <p className="text-caption text-muted-foreground">{STATUS_KIND_META[kind].hint}</p>
          </Section>

          {/* Media */}
          {kind !== "text" && (
            <Section title="Mídia">
              {media ? (
                <div className="panel overflow-hidden">
                  <div className="flex items-center justify-between gap-3 border-b border-border/70 px-4 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{media.name ?? "Arquivo enviado"}</p>
                      <p className="text-caption text-muted-foreground">
                        {media.sizeBytes ? formatBytes(media.sizeBytes) : "tamanho desconhecido"}
                      </p>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => setMedia(null)}>
                      <X className="size-4" />
                      Trocar
                    </Button>
                  </div>
                  <div className="bg-black/40">
                    {kind === "image" && (
                      <img src={media.url} alt="Pré-visualização do status" className="max-h-72 w-full object-contain" />
                    )}
                    {kind === "video" && <video src={media.url} controls className="max-h-72 w-full" />}
                    {kind === "audio" && <audio src={media.url} controls className="w-full p-3" />}
                  </div>
                  <p className="break-all border-t border-border/70 px-4 py-2 font-mono text-[11px] text-muted-foreground">
                    {media.url}
                  </p>
                </div>
              ) : (
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragging(true);
                  }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={onDrop}
                  className={cn(
                    "flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed px-6 py-10 text-center transition-colors",
                    dragging ? "border-primary bg-primary/10" : "border-border bg-card/40",
                  )}
                >
                  <span className="grid size-11 place-items-center rounded-full bg-primary/10 text-primary">
                    {uploading ? <Loader2 className="size-5 animate-spin" /> : <Upload className="size-5" />}
                  </span>
                  <div className="space-y-1">
                    <p className="text-sm font-medium">
                      {uploading ?? "Arraste o arquivo aqui ou escolha do computador"}
                    </p>
                    <p className="text-caption text-muted-foreground">
                      {kind === "image" && "JPG, PNG, WEBP, GIF ou AVIF"}
                      {kind === "video" && "MP4 ou WEBM — até 30 segundos carrega melhor"}
                      {kind === "audio" && "MP3 ou WAV"}
                    </p>
                  </div>
                  <input
                    ref={fileInput}
                    type="file"
                    accept={UPLOAD_ACCEPT_BY_KIND[kind as Exclude<StatusKind, "text">]}
                    className="hidden"
                    onChange={onFileInput}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={Boolean(uploading)}
                    onClick={() => fileInput.current?.click()}
                  >
                    Escolher arquivo
                  </Button>
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="external-url" className="flex items-center gap-1.5 text-caption text-muted-foreground">
                  <Link2 className="size-3.5" />
                  ou use uma URL pública já hospedada
                </Label>
                <Input
                  id="external-url"
                  placeholder="https://seu-site.com/cardapio-de-hoje.jpg"
                  value={externalUrl}
                  onChange={(e) => {
                    setExternalUrl(e.target.value);
                    if (e.target.value) setMedia(null);
                    resetResult();
                  }}
                />
              </div>

              {kindAssets.length > 0 && (
                <div className="space-y-2">
                  <p className="text-caption text-muted-foreground">Já enviados por você</p>
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {kindAssets.map((a) => (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => {
                          setMedia({
                            url: a.publicUrl,
                            name: a.fileName,
                            mimeType: a.mimeType,
                            sizeBytes: a.sizeBytes,
                          });
                          setExternalUrl("");
                          resetResult();
                        }}
                        className="focus-ring shrink-0 overflow-hidden rounded-lg border border-border hover:border-primary/60"
                        title={a.fileName}
                      >
                        {a.kind === "image" ? (
                          <img src={a.publicUrl} alt={a.fileName} className="size-16 object-cover" />
                        ) : (
                          <span className="grid size-16 place-items-center bg-muted text-muted-foreground">
                            {a.kind === "video" ? <Film className="size-5" /> : <Music className="size-5" />}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {uploadError && (
                <p className="flex items-start gap-2 text-sm text-destructive">
                  <AlertCircle className="mt-0.5 size-4 shrink-0" />
                  {uploadError}
                </p>
              )}
            </Section>
          )}

          {/* Caption */}
          <Section title={kind === "text" ? "Texto do status" : "Legenda"}>
            <div className="space-y-2">
              <Textarea
                value={caption}
                onChange={(e) => {
                  setCaption(e.target.value);
                  resetResult();
                }}
                maxLength={CAPTION_MAX}
                placeholder={
                  kind === "text"
                    ? "Hoje tem feijoada — pedidos até as 11h pelo WhatsApp!"
                    : "Cardápio de hoje — pedidos até 11h"
                }
                aria-label={kind === "text" ? "Texto do status" : "Legenda do status"}
              />
              <div className="flex items-center justify-between">
                <p className="text-caption text-muted-foreground">
                  {kind === "audio"
                    ? "Status de áudio não leva legenda — o recado é a própria voz."
                    : "A legenda aparece sobre a imagem ou o vídeo."}
                </p>
                <span className={cn("tabular text-caption", caption.length > CAPTION_MAX * 0.9 ? "text-warning" : "text-muted-foreground")}>
                  {caption.length}/{CAPTION_MAX}
                </span>
              </div>
            </div>
          </Section>

          {/* Audience */}
          <AudiencePicker
            mode={audienceMode}
            onModeChange={(m) => {
              setAudienceMode(m);
              resetResult();
            }}
            pickedIds={pickedIds}
            onPickedChange={(ids) => {
              setPickedIds(ids);
              resetResult();
            }}
            extraJids={extraJids}
            onRemoveExtra={(jid) => setExtraJids((prev) => prev.filter((j) => j !== jid))}
            extraNumber={extraNumber}
            onExtraNumberChange={setExtraNumber}
            onAddExtra={addExtraNumber}
          />
        </div>

        {/* Publish rail */}
        <div className="space-y-4 lg:sticky lg:top-24 lg:self-start">
          <div className="panel space-y-4 p-5">
            <div className="space-y-1">
              <h2>Resumo da publicação</h2>
              <p className="text-caption text-muted-foreground">
                Publica agora, pela instância <span className="font-medium text-foreground">{selected?.label}</span>.
              </p>
            </div>

            <dl className="space-y-2.5 text-sm">
              <Row label="Tipo" value={STATUS_KIND_META[kind].label} />
              <Row
                label="Mídia"
                value={
                  kind === "text"
                    ? "—"
                    : media?.name || (externalUrl ? "URL externa" : "nenhuma")
                }
              />
              <Row
                label="Quem vê"
                value={
                  audienceMode === "all"
                    ? "Todos os contatos"
                    : `${pickedIds.length + extraJids.length} contato(s)`
                }
              />
              <Row label="Duração" value="24 horas no WhatsApp" />
            </dl>

            <div className="rounded-lg border border-border/70 bg-muted/30 p-3">
              <p className="text-caption text-muted-foreground">
                O agendamento automático não faz parte deste painel: a plataforma não oferece
                agendador de tarefas, então a publicação é sempre imediata. Use “Todos os contatos”
                ou uma lista para segmentar.
              </p>
            </div>

            {validation && (
              <p className="flex items-start gap-2 text-sm text-warning">
                <AlertCircle className="mt-0.5 size-4 shrink-0" />
                {validation}
              </p>
            )}

            <Button
              className="w-full"
              size="lg"
              disabled={!canPublish}
              onClick={() => {
                if (!selected) return;
                publish.mutate({
                  instanceId: selected.id,
                  kind,
                  caption: caption.trim() || undefined,
                  mediaUrl: kind === "text" ? undefined : effectiveUrl || undefined,
                  fileName: media?.name ?? undefined,
                  mimeType: media?.mimeType ?? undefined,
                  audienceMode,
                  contactIds: pickedIds,
                  extraJids,
                });
              }}
            >
              {publish.isPending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              {publish.isPending ? "Publicando…" : "Publicar em Status"}
            </Button>

            {publish.isError && (
              <ErrorState
                title="A publicação não foi aceita"
                body={publish.error.message}
                onRetry={() => {
                  if (!selected) return;
                  publish.mutate({
                    instanceId: selected.id,
                    kind,
                    caption: caption.trim() || undefined,
                    mediaUrl: kind === "text" ? undefined : effectiveUrl || undefined,
                    fileName: media?.name ?? undefined,
                    mimeType: media?.mimeType ?? undefined,
                    audienceMode,
                    contactIds: pickedIds,
                    extraJids,
                  });
                }}
              />
            )}
          </div>

          {result?.ok && (
            <div className="rounded-xl border border-success/40 bg-success/5 p-5">
              <p className="flex items-center gap-2 text-sm font-semibold text-success">
                <CheckCircle2 className="size-4" />
                Status publicado
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {formatDateTime(result.post.publishedAt)} ·{" "}
                {result.post.audienceMode === "all"
                  ? "visível para todos os contatos"
                  : `visível para ${result.post.statusJidList?.length ?? 0} contato(s)`}
              </p>
              {result.post.providerMessageId && (
                <p className="mt-2 break-all font-mono text-caption text-muted-foreground">
                  ID: {result.post.providerMessageId}
                </p>
              )}
              <div className="mt-3 flex gap-2">
                <Button asChild size="sm" variant="outline">
                  <Link href="/historico">Ver no histórico</Link>
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setCaption("");
                    setMedia(null);
                    setExternalUrl("");
                    resetResult();
                  }}
                >
                  Publicar outro
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="truncate text-right font-medium">{value}</dd>
    </div>
  );
}

function AudiencePicker({
  mode,
  onModeChange,
  pickedIds,
  onPickedChange,
  extraJids,
  onRemoveExtra,
  extraNumber,
  onExtraNumberChange,
  onAddExtra,
}: {
  mode: "all" | "list";
  onModeChange: (m: "all" | "list") => void;
  pickedIds: string[];
  onPickedChange: (ids: string[]) => void;
  extraJids: string[];
  onRemoveExtra: (jid: string) => void;
  extraNumber: string;
  onExtraNumberChange: (v: string) => void;
  onAddExtra: () => void;
}) {
  const [search, setSearch] = useState("");
  const contacts = trpc.contacts.list.useQuery({ q: search.trim() || undefined });
  const list = contacts.data ?? [];

  function toggle(id: string) {
    onPickedChange(pickedIds.includes(id) ? pickedIds.filter((x) => x !== id) : [...pickedIds, id]);
  }

  return (
    <Section title="Quem pode ver">
      <div className="space-y-3">
        <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Audiência do status">
          {(
            [
              { value: "all", label: "Todos os contatos", hint: "Segue a privacidade de status da instância" },
              { value: "list", label: "Lista selecionada", hint: "Só quem você escolher vê esta publicação" },
            ] as const
          ).map((option) => {
            const active = mode === option.value;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => onModeChange(option.value)}
                className={cn(
                  "focus-ring rounded-xl border p-3.5 text-left transition-colors",
                  active
                    ? "border-primary/60 bg-primary/10"
                    : "border-border bg-card/50 hover:border-primary/30 hover:bg-accent/40",
                )}
              >
                <span className="block text-sm font-medium">{option.label}</span>
                <span className="mt-0.5 block text-caption text-muted-foreground">{option.hint}</span>
              </button>
            );
          })}
        </div>

        {mode === "list" && (
          <div className="space-y-3 rounded-xl border border-border bg-card/40 p-4">
            {(pickedIds.length > 0 || extraJids.length > 0) && (
              <div className="flex flex-wrap gap-1.5">
                <Badge variant="default">{pickedIds.length + extraJids.length} selecionado(s)</Badge>
                {extraJids.map((jid) => (
                  <button
                    key={jid}
                    type="button"
                    onClick={() => onRemoveExtra(jid)}
                    className="focus-ring inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-0.5 text-xs hover:bg-accent"
                  >
                    {jid.split("@")[0]}
                    <X className="size-3" />
                  </button>
                ))}
              </div>
            )}

            <div className="flex gap-2">
              <Input
                placeholder="Buscar contato por nome ou número"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Buscar contato"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onPickedChange([])}
                disabled={pickedIds.length === 0}
              >
                Limpar
              </Button>
            </div>

            <div className="max-h-56 space-y-1 overflow-y-auto pr-1">
              {contacts.isLoading && <p className="p-3 text-sm text-muted-foreground">Carregando contatos…</p>}
              {!contacts.isLoading && list.length === 0 && (
                <div className="p-3">
                  <p className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Users className="size-4" />
                    {search
                      ? "Nenhum contato encontrado para essa busca."
                      : "Você ainda não tem contatos. Sincronize em Contatos ou adicione um número abaixo."}
                  </p>
                </div>
              )}
              {list.map((c) => {
                const active = pickedIds.includes(c.id);
                return (
                  <label
                    key={c.id}
                    className={cn(
                      "flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                      active ? "bg-primary/10" : "hover:bg-accent/50",
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={active}
                      onChange={() => toggle(c.id)}
                      className="size-4 accent-[hsl(168_72%_34%)]"
                    />
                    <span className="min-w-0 flex-1 truncate">{c.name ?? "Sem nome"}</span>
                    <span className="tabular shrink-0 text-caption text-muted-foreground">
                      {c.number ?? c.jid.split("@")[0]}
                    </span>
                  </label>
                );
              })}
            </div>

            <div className="space-y-1.5 border-t border-border/70 pt-3">
              <Label htmlFor="extra-number" className="text-caption text-muted-foreground">
                Adicionar um número que não está na lista
              </Label>
              <div className="flex gap-2">
                <Input
                  id="extra-number"
                  inputMode="numeric"
                  placeholder="5511999999999"
                  value={extraNumber}
                  onChange={(e) => onExtraNumberChange(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      onAddExtra();
                    }
                  }}
                />
                <Button type="button" variant="outline" size="sm" onClick={onAddExtra}>
                  Adicionar
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Section>
  );
}
