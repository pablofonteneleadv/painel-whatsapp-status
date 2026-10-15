// ── WAME API client (server-only) ─────────────────────────────────────────────
// The operator's API key is the `{key}` path segment of every WAME endpoint, so
// it MUST stay on the server: the browser talks to our tRPC API, never to
// server.wame.api.br. Compose the platform primitive (_core/fetch) for outbound
// HTTP — never a raw SDK.
//
// Contract verified against https://server.wame.api.br/docs/swagger.json
// (Status, Instance, Contacts and Messages tags).
import { outboundFetch } from "../_core/fetch";
import {
  WAME_DEFAULT_SERVER,
  buildStatusPayload,
  extractMessageId,
  extractQrImage,
  parseContacts,
  parseInstanceHealth,
  statusPath,
  wameErrorMessage,
  type ConnectionState,
  type StatusKind,
  type WameContact,
} from "../../shared/wame";

export interface WameTarget {
  serverUrl: string | null;
  apiKey: string;
}

/** A provider failure, carrying the status so routers can map it to a TRPCError. */
export class WameError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly payload: unknown,
  ) {
    super(message);
    this.name = "WameError";
  }
}

const TIMEOUT_MS = 25_000;

function normaliseServer(serverUrl: string | null): string {
  const raw = (serverUrl ?? "").trim() || WAME_DEFAULT_SERVER;
  return raw.replace(/\/+$/, "");
}

/** Absolute URL for a WAME path. The key is URL-encoded: it is a path segment. */
export function wameUrl(target: WameTarget, path: string): string {
  return `${normaliseServer(target.serverUrl)}/${encodeURIComponent(target.apiKey.trim())}${path}`;
}

interface CallOptions {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
}

function withQuery(path: string, query?: CallOptions["query"]): string {
  if (!query) return path;
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined) usp.append(k, String(v));
  }
  const qs = usp.toString();
  return qs ? `${path}?${qs}` : path;
}

async function call(target: WameTarget, opts: CallOptions): Promise<unknown> {
  const url = wameUrl(target, withQuery(opts.path, opts.query));
  const res = await outboundFetch(url, {
    method: opts.method,
    headers: opts.body === undefined ? undefined : { "content-type": "application/json" },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    timeoutMs: TIMEOUT_MS,
  });

  const text = await res.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { raw: text.slice(0, 2000) };
    }
  }

  if (!res.ok) throw new WameError(wameErrorMessage(res.status, payload), res.status, payload);
  return payload;
}

// ── Status (stories) ─────────────────────────────────────────────────────────

export interface PublishStatusInput {
  kind: StatusKind;
  caption?: string | null;
  mediaUrl?: string | null;
  jids?: string[] | null;
}

export interface PublishStatusResult {
  messageId: string | null;
  response: unknown;
}

/**
 * Publish one status. This is the app's central operation: it builds the exact
 * provider body (see buildStatusPayload) and posts it to /status/{kind}.
 */
export async function publishStatus(target: WameTarget, input: PublishStatusInput): Promise<PublishStatusResult> {
  const body = buildStatusPayload(input.kind, {
    caption: input.caption,
    mediaUrl: input.mediaUrl,
    jids: input.jids,
  });
  const response = await call(target, { method: "POST", path: statusPath(input.kind), body });
  return { messageId: extractMessageId(response), response };
}

/** Mention a contact in an already-published status. */
export async function mentionInStatus(
  target: WameTarget,
  input: { jid: string; statusMsgId: string },
): Promise<unknown> {
  return call(target, {
    method: "POST",
    path: "/status/mention",
    body: { jid: input.jid, statusMsgId: input.statusMsgId },
  });
}

// ── Instance ─────────────────────────────────────────────────────────────────

export interface InstanceHealth {
  state: ConnectionState;
  detail: string | null;
  response: unknown;
}

/** Cheap connection check (GET /{key}/instance/health) — no Meta Graph call. */
export async function instanceHealth(target: WameTarget): Promise<InstanceHealth> {
  const response = await call(target, { method: "GET", path: "/instance/health" });
  const { state, detail } = parseInstanceHealth(response);
  return { state, detail, response };
}

/** Full instance details (GET /{key}/instance). */
export async function instanceDetails(target: WameTarget): Promise<unknown> {
  return call(target, { method: "GET", path: "/instance" });
}

/** Start a QR Code connection (POST /{key}/instance) → data URI or URL. */
export async function connectWithQr(target: WameTarget): Promise<{ qrImage: string | null; response: unknown }> {
  const response = await call(target, { method: "POST", path: "/instance" });
  return { qrImage: extractQrImage(response), response };
}

export interface WebhookConfig {
  webhookUrl: string | null;
  webhookFormat: "native" | "meta" | "both";
}

/** Configure webhooks (PUT /{key}/instance). `allowWebhook` is required. */
export async function configureWebhooks(target: WameTarget, cfg: WebhookConfig): Promise<unknown> {
  const url = (cfg.webhookUrl ?? "").trim();
  return call(target, {
    method: "PUT",
    path: "/instance",
    body: {
      allowWebhook: url.length > 0,
      allowNumber: "all",
      webhookFormat: cfg.webhookFormat,
      webhookMessage: url,
      webhookGroup: url,
      webhookConnection: url,
      webhookQrCode: url,
      webhookHistory: url,
    },
  });
}

/** Disconnect and log out the instance (DELETE /{key}/instance). */
export async function disconnect(target: WameTarget): Promise<unknown> {
  return call(target, { method: "DELETE", path: "/instance" });
}

// ── Contacts ─────────────────────────────────────────────────────────────────

/** List all contacts (GET /{key}/contacts). */
export async function listContacts(target: WameTarget): Promise<WameContact[]> {
  const response = await call(target, { method: "GET", path: "/contacts" });
  return parseContacts(response);
}

// ── Messages ─────────────────────────────────────────────────────────────────

export async function sendText(
  target: WameTarget,
  input: { to: string; text: string },
): Promise<PublishStatusResult> {
  const response = await call(target, {
    method: "POST",
    path: "/message/text",
    body: { to: input.to, text: input.text, provider: "whatsapp" },
  });
  return { messageId: extractMessageId(response), response };
}

export async function sendImage(
  target: WameTarget,
  input: { to: string; url: string; caption?: string | null },
): Promise<PublishStatusResult> {
  const body: Record<string, unknown> = { to: input.to, url: input.url, provider: "whatsapp" };
  if (input.caption && input.caption.trim()) body.caption = input.caption.trim();
  const response = await call(target, { method: "POST", path: "/message/image", body });
  return { messageId: extractMessageId(response), response };
}
