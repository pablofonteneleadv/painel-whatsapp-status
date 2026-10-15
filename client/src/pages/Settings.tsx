import { useState, type FormEvent } from "react";
import { trpc } from "@/_core/trpc";
import { useInstance, type InstanceView } from "@/components/InstanceProvider";
import { PageHeader, Section } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { WAME_DEFAULT_SERVER, connectionLabel, type ConnectionState } from "@shared/wame";
import { formatDateTime } from "@/lib/format";
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  Plug,
  Plus,
  Power,
  QrCode,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Trash2,
} from "lucide-react";

/**
 * Instance configuration: the API key, the server, the webhooks, and the
 * connection tools (health check, QR Code, disconnect). Nothing here ever shows
 * the full key — the router only returns a masked value.
 */
export default function Settings() {
  const { instances, selected, selectInstance, refetch } = useInstance();
  const utils = trpc.useUtils();
  const [showForm, setShowForm] = useState(instances.length === 0);

  const onInstanceChange = () => {
    void refetch();
    void utils.instances.list.invalidate();
  };

  return (
    <div className="space-y-7">
      <PageHeader
        title="Configurações"
        description="Conecte sua instância da WAME, acompanhe o estado da conexão e configure o aviso de webhooks."
        actions={
          instances.length > 0 && (
            <Button variant="outline" onClick={() => setShowForm((v) => !v)}>
              <Plus className="size-4" />
              {showForm ? "Fechar formulário" : "Nova instância"}
            </Button>
          )
        }
      />

      <Section title="Como funciona">
        <div className="panel grid gap-4 p-5 sm:grid-cols-3">
          {[
            {
              icon: Smartphone,
              title: "1. Conecte o número",
              body: "Cole a chave da sua instância (server.wame.api.br). Se o número ainda não estiver pareado, gere o QR Code aqui e leia no celular.",
            },
            {
              icon: Plug,
              title: "2. Publique",
              body: "Com a instância conectada, o compositor envia imagens e vídeos com legenda direto para o Status.",
            },
            {
              icon: ShieldCheck,
              title: "3. Chave protegida",
              body: "A chave fica guardada no servidor e nunca é enviada ao navegador — aqui você vê apenas a versão mascarada.",
            },
          ].map(({ icon: Icon, title, body }) => (
            <div key={title} className="space-y-2">
              <span className="grid size-9 place-items-center rounded-lg bg-primary/10 text-primary">
                <Icon className="size-4" />
              </span>
              <p className="text-sm font-medium">{title}</p>
              <p className="text-caption leading-relaxed text-muted-foreground">{body}</p>
            </div>
          ))}
        </div>
      </Section>

      {showForm && <InstanceForm onDone={onInstanceChange} onClose={() => instances.length > 0 && setShowForm(false)} />}

      <Section title={instances.length > 1 ? "Instâncias" : "Sua instância"}>
        {instances.length === 0 && !showForm ? (
          <EmptyState
            icon={Plug}
            title="Nenhuma instância cadastrada"
            body="Adicione a chave da API da sua instância para liberar a publicação em Status e o envio de mensagens."
            action={
              <Button onClick={() => setShowForm(true)}>
                <Plus className="size-4" />
                Adicionar instância
              </Button>
            }
          />
        ) : (
          <div className="space-y-4">
            {instances.map((instance) => (
              <InstanceCard
                key={instance.id}
                instance={instance}
                isActive={selected?.id === instance.id}
                onSelect={() => selectInstance(instance.id)}
                onChanged={onInstanceChange}
              />
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

/** Create form. Only shown when the account has no instance, or on request. */
function InstanceForm({ onDone, onClose }: { onDone: () => void; onClose: () => void }) {
  const [label, setLabel] = useState("Minha instância");
  const [serverUrl, setServerUrl] = useState(WAME_DEFAULT_SERVER);
  const [apiKey, setApiKey] = useState("");

  const create = trpc.instances.create.useMutation({
    onSuccess: () => {
      setApiKey("");
      onDone();
      onClose();
    },
  });

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    create.mutate({
      label: label.trim() || "Minha instância",
      serverUrl: serverUrl.trim() || undefined,
      apiKey,
    });
  }

  return (
    <form onSubmit={onSubmit} className="panel space-y-5 p-5">
      <div className="space-y-1">
        <h2>Adicionar instância</h2>
        <p className="text-caption text-muted-foreground">
          A chave é o trecho que aparece no endereço dos endpoints da WAME (<span className="font-mono">/{'{'}chave{'}'}/status/image</span>).
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="i-label">Nome da instância</Label>
          <Input
            id="i-label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Loja principal"
            required
            maxLength={80}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="i-server">Endereço do servidor</Label>
          <Input
            id="i-server"
            value={serverUrl}
            onChange={(e) => setServerUrl(e.target.value)}
            placeholder={WAME_DEFAULT_SERVER}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="i-key">Chave da API</Label>
        <Input
          id="i-key"
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="cole a chave da sua instância"
          autoComplete="off"
          required
          minLength={8}
        />
      </div>

      {create.isError && (
        <p className="flex items-start gap-2 text-sm text-destructive">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          {create.error.message}
        </p>
      )}

      <div className="flex gap-2">
        <Button type="submit" disabled={create.isPending || apiKey.trim().length < 8}>
          {create.isPending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
          Salvar instância
        </Button>
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}

function InstanceCard({
  instance,
  isActive,
  onSelect,
  onChanged,
}: {
  instance: InstanceView;
  isActive: boolean;
  onSelect: () => void;
  onChanged: () => void;
}) {
  const [qr, setQr] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [label, setLabel] = useState(instance.label);
  const [serverUrl, setServerUrl] = useState(instance.serverUrl);
  const [newKey, setNewKey] = useState("");
  const [webhookUrl, setWebhookUrl] = useState(instance.webhookUrl ?? "");
  const [webhookFormat, setWebhookFormat] = useState(instance.webhookFormat);

  const health = trpc.instances.health.useMutation({ onSuccess: onChanged });
  const generateQr = trpc.instances.qr.useMutation({
    onSuccess: (data) => {
      setQr(data.qrImage);
      onChanged();
    },
  });
  const disconnect = trpc.instances.disconnect.useMutation({ onSuccess: onChanged });
  const update = trpc.instances.update.useMutation({
    onSuccess: () => {
      setEditing(false);
      setNewKey("");
      onChanged();
    },
  });
  const remove = trpc.instances.remove.useMutation({ onSuccess: onChanged });
  const saveWebhooks = trpc.instances.setWebhooks.useMutation({ onSuccess: onChanged });

  const state = instance.lastStatus as ConnectionState;
  const variant =
    state === "connected"
      ? "success"
      : state === "qr"
        ? "warning"
        : state === "unknown"
          ? "outline"
          : "destructive";

  return (
    <div className="panel overflow-hidden">
      <div className="flex flex-wrap items-start gap-4 p-5">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
          <Smartphone className="size-5" />
        </span>
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold">{instance.label}</p>
            <Badge variant={variant}>{connectionLabel(state)}</Badge>
            {isActive && <Badge variant="outline">Ativa no painel</Badge>}
          </div>
          <p className="font-mono text-caption text-muted-foreground">{instance.serverUrl}</p>
          <p className="text-caption text-muted-foreground">
            Chave: <span className="font-mono">{instance.apiKeyMasked ?? "—"}</span> · última verificação:{" "}
            {instance.lastCheckedAt ? formatDateTime(instance.lastCheckedAt) : "nunca"}
          </p>
          {instance.lastStatusDetail && (
            <p className="text-caption text-muted-foreground">
              Resposta da WAME: <span className="font-mono">{instance.lastStatusDetail}</span>
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!isActive && (
            <Button variant="outline" size="sm" onClick={onSelect}>
              Usar esta
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            disabled={health.isPending}
            onClick={() => health.mutate({ id: instance.id })}
          >
            {health.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
            Verificar conexão
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={generateQr.isPending}
            onClick={() => generateQr.mutate({ id: instance.id })}
          >
            {generateQr.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <QrCode className="size-3.5" />}
            QR Code
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setEditing((v) => !v)}>
            Editar
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={disconnect.isPending}
            onClick={() => disconnect.mutate({ id: instance.id })}
          >
            {disconnect.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Power className="size-3.5" />}
            Desconectar
          </Button>
        </div>
      </div>

      {health.isError && (
        <div className="border-t border-border/70 p-4">
          <ErrorState title="A verificação falhou" body={health.error.message} />
        </div>
      )}
      {health.isSuccess && (
        <p className="flex items-center gap-2 border-t border-border/70 p-4 text-sm text-success">
          <CheckCircle2 className="size-4" />
          Resposta recebida: {connectionLabel(health.data.state)}.
        </p>
      )}
      {generateQr.isError && (
        <div className="border-t border-border/70 p-4">
          <ErrorState title="Não foi possível gerar o QR Code" body={generateQr.error.message} />
        </div>
      )}

      {qr && (
        <div className="space-y-3 border-t border-border/70 bg-muted/20 p-5">
          <div className="space-y-1">
            <h3 className="text-subheading text-muted-foreground">Leia no WhatsApp</h3>
            <p className="text-caption text-muted-foreground">
              Abra o WhatsApp no celular → Aparelhos conectados → Conectar um aparelho, e aponte para o código.
              Ele expira em poucos minutos: gere outro se não funcionar.
            </p>
          </div>
          <div className="flex flex-wrap items-start gap-4">
            <img
              src={qr}
              alt="QR Code para conectar a instância"
              className="size-52 rounded-xl border border-border bg-white p-2"
            />
            <Button
              variant="outline"
              size="sm"
              disabled={health.isPending}
              onClick={() => health.mutate({ id: instance.id })}
            >
              <RefreshCw className="size-3.5" />
              Já li — verificar conexão
            </Button>
          </div>
        </div>
      )}

      {editing && (
        <div className="space-y-4 border-t border-border/70 bg-muted/20 p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={`e-label-${instance.id}`}>Nome</Label>
              <Input id={`e-label-${instance.id}`} value={label} onChange={(e) => setLabel(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`e-server-${instance.id}`}>Servidor</Label>
              <Input id={`e-server-${instance.id}`} value={serverUrl} onChange={(e) => setServerUrl(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`e-key-${instance.id}`}>Trocar a chave da API (opcional)</Label>
            <Input
              id={`e-key-${instance.id}`}
              type="password"
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              placeholder="deixe em branco para manter a chave atual"
              autoComplete="off"
            />
          </div>

          <div className="space-y-3 border-t border-border/70 pt-4">
            <div className="space-y-1">
              <p className="text-sm font-medium">Webhooks de recebimento</p>
              <p className="text-caption text-muted-foreground">
                O painel entrega webhooks à WAME, mas não recebe eventos: este app não expõe um endpoint público
                para isso. O endereço serve para você apontar a sua própria automação.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-[1fr_10rem]">
              <div className="space-y-1.5">
                <Label htmlFor={`e-hook-${instance.id}`}>URL do webhook</Label>
                <Input
                  id={`e-hook-${instance.id}`}
                  value={webhookUrl}
                  onChange={(e) => setWebhookUrl(e.target.value)}
                  placeholder="https://sua-automacao.com/webhook"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`e-fmt-${instance.id}`}>Formato</Label>
                <Select
                  id={`e-fmt-${instance.id}`}
                  value={webhookFormat}
                  onChange={(e) => setWebhookFormat(e.target.value)}
                >
                  <option value="native">native</option>
                  <option value="meta">meta</option>
                  <option value="both">both</option>
                </Select>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={saveWebhooks.isPending}
              onClick={() =>
                saveWebhooks.mutate({
                  id: instance.id,
                  webhookUrl: webhookUrl.trim() || null,
                  webhookFormat: webhookFormat as "native" | "meta" | "both",
                })
              }
            >
              {saveWebhooks.isPending && <Loader2 className="size-3.5 animate-spin" />}
              Salvar webhooks
            </Button>
            {saveWebhooks.isError && <p className="text-caption text-destructive">{saveWebhooks.error.message}</p>}
            {saveWebhooks.isSuccess && <p className="text-caption text-success">Webhooks atualizados na WAME.</p>}
          </div>

          <div className="flex flex-wrap gap-2 border-t border-border/70 pt-4">
            <Button
              size="sm"
              disabled={update.isPending || label.trim().length === 0}
              onClick={() =>
                update.mutate({
                  id: instance.id,
                  label: label.trim(),
                  serverUrl: serverUrl.trim(),
                  apiKey: newKey.trim() ? newKey.trim() : undefined,
                })
              }
            >
              {update.isPending && <Loader2 className="size-3.5 animate-spin" />}
              Salvar alterações
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
              Cancelar
            </Button>
            <div className="ml-auto">
              {confirmDelete ? (
                <div className="flex items-center gap-2">
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={remove.isPending}
                    onClick={() => remove.mutate({ id: instance.id })}
                  >
                    <Trash2 className="size-3.5" />
                    Confirmar exclusão
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
                    Cancelar
                  </Button>
                </div>
              ) : (
                <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(true)}>
                  <Trash2 className="size-3.5" />
                  Excluir instância
                </Button>
              )}
            </div>
          </div>
          {update.isError && <p className="text-caption text-destructive">{update.error.message}</p>}
        </div>
      )}
    </div>
  );
}
