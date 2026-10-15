// ── WAME API contract (shared client ↔ server) ────────────────────────────────
// Pure helpers only: no Node built-ins, no fetch, no secrets. The API key is a
// SERVER-ONLY secret — it is never rendered in the clear, only masked.
//
// Endpoints used by this panel (verified against
// https://server.wame.api.br/docs/swagger.json):
//   POST   /{key}/status/image    { url, caption, statusJidList }
//   POST   /{key}/status/video    { url, caption, statusJidList }
//   POST   /{key}/status/text     { text, statusJidList }
//   POST   /{key}/status/audio    { url, statusJidList }
//   POST   /{key}/status/mention  { jid, statusMsgId }
//   GET    /{key}/instance              instance details
//   GET    /{key}/instance/health       cheap connection check
//   POST   /{key}/instance              connect via QR Code
//   PUT    /{key}/instance              configure webhooks (allowWebhook required)
//   DELETE /{key}/instance              disconnect and logout
//   GET    /{key}/contacts              list contacts
//   POST   /{key}/message/text          { to, text }
//   POST   /{key}/message/image         { to, url, caption }

import { WAME_API_KEY_MASK_PREFIX, WAME_API_KEY_MASK_SUFFIX } from "./constants";

export const WAME_DEFAULT_SERVER = "https://server.wame.api.br";

export const STATUS_KINDS = ["image", "video", "text", "audio"] as const;
export type StatusKind = (typeof STATUS_KINDS)[number];

export const STATUS_KIND_META: Record<
  StatusKind,
  { label: string; hint: string; field: string; accepts: string | null }
> = {
  image: {
    label: "Imagem",
    hint: "JPG, PNG, WEBP ou GIF. Publica a foto com a legenda por cima.",
    field: "url",
    accepts: "image/jpeg,image/png,image/webp,image/gif,image/avif",
  },
  video: {
    label: "Vídeo",
    hint: "MP4, de preferência até 30 segundos — carrega mais rápido no celular de quem vê.",
    field: "url",
    accepts: "video/mp4,video/webm",
  },
  text: {
    label: "Texto",
    hint: "Só texto, com o fundo que o WhatsApp escolhe.",
    field: "text",
    accepts: null,
  },
  audio: {
    label: "Áudio",
    hint: "Sai como mensagem de voz. Formato pouco usado — e por isso chama atenção.",
    field: "url",
    accepts: "audio/mpeg,audio/wav",
  },
};

/** Caption ceiling for status media. WhatsApp truncates long video captions. */
export const CAPTION_MAX = 1024;
export const VIDEO_CAPTION_RECOMMENDED = 700;

/** Upload whitelist enforced by platform storage — mirrored here for the picker. */
export const UPLOAD_ACCEPT_BY_KIND: Record<Exclude<StatusKind, "text">, string> = {
  image: ".jpg,.jpeg,.png,.webp,.gif,.avif",
  video: ".mp4,.webm",
  audio: ".mp3,.wav",
};

const MIME_TO_KIND: Record<string, Exclude<StatusKind, "text">> = {
  "image/jpeg": "image",
  "image/png": "image",
  "image/webp": "image",
  "image/gif": "image",
  "image/avif": "image",
  "video/mp4": "video",
  "video/webm": "video",
  "audio/mpeg": "audio",
  "audio/wav": "audio",
};

/** Which status kind a browser content type belongs to, or null if unsupported. */
export function kindForMime(mime: string): Exclude<StatusKind, "text"> | null {
  return MIME_TO_KIND[mime.toLowerCase().split(";")[0].trim()] ?? null;
}

/**
 * Normalise a phone number or JID into the audience format the API expects
 * (`5511999999999@s.whatsapp.net`). Group JIDs (`@g.us`) are passed through so a
 * mis-pasted group never silently becomes a fake phone JID.
 */
export function normalizeJid(input: string): string | null {
  const raw = (input ?? "").trim();
  if (!raw) return null;
  if (raw.endsWith("@g.us")) return raw;
  const digits = raw.replace(/[^0-9]/g, "");
  if (digits.length < 10 || digits.length > 15) return null;
  return `${digits}@s.whatsapp.net`;
}

/** Bare digits from a JID / raw number — for display in lists. */
export function jidToNumber(jid: string): string {
  return (jid ?? "").split("@")[0].replace(/[^0-9]/g, "");
}

/** Pretty-print a Brazilian number for the UI: +55 11 99999-9999 when possible. */
export function formatNumber(jidOrNumber: string): string {
  const d = jidToNumber(jidOrNumber);
  if (d.length === 13) return `+${d.slice(0, 2)} ${d.slice(2, 4)} ${d.slice(4, 9)}-${d.slice(9)}`;
  if (d.length === 12) return `+${d.slice(0, 2)} ${d.slice(2, 4)} ${d.slice(4, 8)}-${d.slice(8)}`;
  if (d.length >= 10) return `+${d}`;
  return jidOrNumber;
}

/**
 * Mask an API key for display: first 4 + last 2 characters. Short keys are
 * masked entirely rather than half-revealed. The full key never leaves the
 * server — this is only ever applied to the masked value the router returns.
 */
export function maskApiKey(key: string | null | undefined): string | null {
  const k = (key ?? "").trim();
  if (!k) return null;
  if (k.length <= WAME_API_KEY_MASK_PREFIX + WAME_API_KEY_MASK_SUFFIX + 2) {
    return "•".repeat(Math.max(4, k.length));
  }
  return `${k.slice(0, WAME_API_KEY_MASK_PREFIX)}${"•".repeat(6)}${k.slice(-WAME_API_KEY_MASK_SUFFIX)}`;
}

export function statusPath(kind: StatusKind): string {
  return `/status/${kind}`;
}

/**
 * Build the exact JSON body for a status publication.
 *
 * `statusJidList` is sent ONLY when the operator narrowed the audience; omitting
 * it makes the API fall back to the instance's own status-privacy setting
 * (normally every contact), which is what "todos" means.
 */
export function buildStatusPayload(
  kind: StatusKind,
  input: { caption?: string | null; mediaUrl?: string | null; jids?: string[] | null },
): Record<string, unknown> {
  const audience = input.jids && input.jids.length > 0 ? { statusJidList: input.jids } : {};
  const caption = (input.caption ?? "").trim();
  if (kind === "text") {
    return { text: caption, ...audience };
  }
  const body: Record<string, unknown> = { url: (input.mediaUrl ?? "").trim() };
  if (kind !== "audio" && caption) body.caption = caption;
  return { ...body, ...audience };
}

/**
 * Validate a publication before it is sent, so the composer can explain the
 * problem instead of surfacing a provider 400.
 */
export function validateStatusDraft(input: {
  kind: StatusKind;
  caption?: string | null;
  mediaUrl?: string | null;
}): string | null {
  const caption = (input.caption ?? "").trim();
  if (input.kind === "text") {
    if (!caption) return "Escreva o texto do status.";
    if (caption.length > CAPTION_MAX) return `O texto passa de ${CAPTION_MAX} caracteres.`;
    return null;
  }
  if (!(input.mediaUrl ?? "").trim()) return "Envie a mídia ou informe uma URL pública.";
  if (input.kind !== "audio" && caption.length > CAPTION_MAX) {
    return `A legenda passa de ${CAPTION_MAX} caracteres.`;
  }
  if (input.kind === "video" && caption.length > VIDEO_CAPTION_RECOMMENDED) {
    return null; // a warning, not a block — the composer shows it as a hint
  }
  return null;
}

export type ConnectionState = "connected" | "disconnected" | "qr" | "error" | "unknown";

const CONNECTION_LABEL: Record<ConnectionState, string> = {
  connected: "Conectado",
  disconnected: "Desconectado",
  qr: "Aguardando QR Code",
  error: "Erro na conexão",
  unknown: "Não verificado",
};

export function connectionLabel(state: ConnectionState): string {
  return CONNECTION_LABEL[state] ?? CONNECTION_LABEL.unknown;
}

function collectStrings(value: unknown, out: string[], depth = 0): void {
  if (depth > 3 || value === null || value === undefined) return;
  if (typeof value === "string") {
    out.push(value);
    return;
  }
  if (typeof value === "boolean" || typeof value === "number") {
    out.push(String(value));
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value.slice(0, 10)) collectStrings(v, out, depth + 1);
    return;
  }
  if (typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>).slice(0, 20)) {
      collectStrings(v, out, depth + 1);
    }
  }
}

/**
 * Read the instance state out of /instance/health.
 *
 * The API answers 200 with an untyped body, so this matches on the vocabulary
 * the provider actually uses (`connected`, `qrcode`, `close`, …) instead of
 * assuming one exact field name. `detail` preserves whatever the provider said,
 * for display next to the pill.
 */
export function parseInstanceHealth(payload: unknown): { state: ConnectionState; detail: string | null } {
  const strings: string[] = [];
  collectStrings(payload, strings);
  const haystack = strings.join(" ").toLowerCase();
  const detail = strings.find((s) => s.trim().length > 0 && s.length <= 60) ?? null;

  if (/\b(qrcode|qr_code|qr code|qrcodegenerated|pairing_code|pairingcode)\b/.test(haystack)) {
    return { state: "qr", detail };
  }
  if (/\b(disconnect|close|closed|logout|logged_out|offline|unauthorized)\b/.test(haystack)) {
    return { state: "disconnected", detail };
  }
  if (/\b(connect|connected|open|online|active|ready)\b/.test(haystack) || haystack.includes("true")) {
    return { state: "connected", detail };
  }
  return { state: "unknown", detail };
}

/** Pull the provider's message id out of a status/message response, tolerantly. */
export function extractMessageId(payload: unknown): string | null {
  const seen = new Set<unknown>();
  const keys = ["statusMsgId", "messageId", "msgId", "id", "key"];
  function walk(node: unknown, depth: number): string | null {
    if (depth > 4 || node === null || typeof node !== "object" || seen.has(node)) return null;
    seen.add(node);
    const obj = node as Record<string, unknown>;
    for (const k of keys) {
      const v = obj[k];
      if (typeof v === "string" && v.length > 0) return v;
      if (v && typeof v === "object") {
        const nested = walk(v, depth + 1);
        if (nested) return nested;
      }
    }
    for (const v of Object.values(obj)) {
      if (v && typeof v === "object") {
        const nested = walk(v, depth + 1);
        if (nested) return nested;
      }
    }
    return null;
  }
  return walk(payload, 0);
}

/** Pull a QR image (data URI or raw base64) out of POST /{key}/instance. */
export function extractQrImage(payload: unknown): string | null {
  const keys = ["qrcode", "qrCode", "qr", "base64", "image", "qrcodeBase64"];
  const obj = (payload ?? {}) as Record<string, unknown>;
  const candidates: unknown[] = [...keys.map((k) => obj[k]), ...Object.values(obj)];
  for (const c of candidates) {
    if (typeof c !== "string" || c.length < 40) continue;
    if (c.startsWith("data:image")) return c;
    if (/^[A-Za-z0-9+/=\s]+$/.test(c)) return `data:image/png;base64,${c.replace(/\s/g, "")}`;
    if (c.startsWith("http")) return c;
  }
  const nested = extractMessageId(payload);
  return nested && nested.startsWith("http") ? nested : null;
}

/** Normalise the contact list returned by GET /{key}/contacts. */
export interface WameContact {
  jid: string;
  number: string | null;
  name: string | null;
}

export function parseContacts(payload: unknown): WameContact[] {
  const root = payload as Record<string, unknown> | null;
  let list: unknown = root;
  if (root && !Array.isArray(root)) {
    for (const k of ["contacts", "data", "result", "items"]) {
      if (Array.isArray(root[k])) {
        list = root[k];
        break;
      }
    }
  }
  if (!Array.isArray(list)) return [];
  const out: WameContact[] = [];
  for (const entry of list.slice(0, 5000)) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const rawId =
      (typeof e.jid === "string" && e.jid) ||
      (typeof e.id === "string" && e.id) ||
      (typeof e.number === "string" && e.number) ||
      null;
    if (!rawId) continue;
    const jid = normalizeJid(rawId);
    if (!jid) continue;
    const name =
      (typeof e.name === "string" && e.name) ||
      (typeof e.pushName === "string" && e.pushName) ||
      (typeof e.verifiedName === "string" && e.verifiedName) ||
      (typeof e.notify === "string" && e.notify) ||
      null;
    out.push({ jid, number: jidToNumber(jid) || null, name: name ? String(name).slice(0, 120) : null });
  }
  return out;
}

/** Human sentence for a provider HTTP failure. */
export function wameErrorMessage(status: number, payload: unknown): string {
  const strings: string[] = [];
  collectStrings(payload, strings);
  const provider =
    strings.find((s) => s.length > 12 && /[a-zá-ú]/i.test(s) && !/^https?:/.test(s)) ?? null;
  if (provider) return provider.slice(0, 300);
  if (status === 401 || status === 403) return "Chave da API recusada pela WAME (401/403). Confira a chave em Configurações.";
  if (status === 404) return "Instância não encontrada na WAME (404). Confira a chave e o servidor.";
  if (status === 429) return "Limite de requisições da WAME atingido (429). Tente de novo em alguns instantes.";
  if (status >= 500) return `A WAME respondeu com erro interno (${status}).`;
  return `A WAME recusou a requisição (${status}).`;
}
