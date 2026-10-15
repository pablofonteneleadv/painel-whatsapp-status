// ── AGENT-OWNED: tRPC API surface ────────────────────────────────────────────
// Compose the app's procedures here. Keep them thin: validate input with zod,
// call server/db.ts for data and server/services/* for external integrations.
// Auth is provided by _core — do NOT reimplement sessions. Access levels:
// publicProcedure (anyone) / protectedProcedure (ctx.user set) / adminProcedure.
//
// The WAME API key is a SERVER-ONLY secret. It is persisted so the operator can
// configure it from the UI, but every read path masks it (maskApiKey) and every
// provider call happens here, never in the browser.
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure, protectedProcedure } from "./_core/trpc";
// Re-exported from _core/db so business code has ONE db-import site; the direct
// import from db-errors is deliberate — it is the same symbol, and importing it
// from _core/db would pull the live driver into every unit test.
import { isUniqueViolation } from "./_core/db-errors";
import { authProvider, registerLocalUser, AuthError, EmailTakenError } from "./_core/auth";
import {
  storageCommit,
  storageDeleteOwned,
  storageListByOwner,
  storagePutUrl,
  StorageError,
} from "./_core/storage";
import * as q from "./db";
import * as wame from "./services/wame";
import { WameError } from "./services/wame";
import {
  STATUS_KINDS,
  WAME_DEFAULT_SERVER,
  maskApiKey,
  normalizeJid,
  validateStatusDraft,
  type StatusKind,
} from "../shared/wame";

// Auth: login/logout are provider-agnostic (go through the AuthProvider).
// signup is LOCAL-only (SSO signup happens at the IdP) — guard if you switch.
const authRouter = router({
  me: publicProcedure.query(({ ctx }) => ctx.user),

  signup: publicProcedure
    .input(z.object({ email: z.email(), password: z.string().min(8), name: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const user = await registerLocalUser(input.email, input.password, input.name);
        await authProvider().login(ctx.c, input.email, input.password); // set session cookie
        return user;
      } catch (e: unknown) {
        // CONFLICT, not a 500: the request was well-formed, the address is just
        // taken. registerLocalUser has already turned the driver's SQLSTATE
        // 23505 into this type — never pattern-match a DB error message here,
        // Drizzle hides it behind a "Failed query: <sql>" wrapper.
        if (e instanceof EmailTakenError) throw new TRPCError({ code: "CONFLICT", message: e.message });
        throw e;
      }
    }),

  login: publicProcedure
    .input(z.object({ email: z.email(), password: z.string() }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await authProvider().login(ctx.c, input.email, input.password);
      } catch (e) {
        if (e instanceof AuthError) throw new TRPCError({ code: "UNAUTHORIZED", message: e.message });
        throw e;
      }
    }),

  logout: publicProcedure.mutation(async ({ ctx }) => {
    await authProvider().logout(ctx.c);
    return { ok: true };
  }),
});

// ── Provider failure → user-actionable tRPC error ────────────────────────────
// A third-party outage or a rejected key is an expected condition of this app,
// not a bug: translate it so the operator reads what to do next instead of the
// opaque 500 that any escaping error becomes.
function toTrpc(e: unknown): never {
  if (e instanceof TRPCError) throw e;
  if (e instanceof WameError) {
    const message = e.message;
    if (e.status === 401 || e.status === 403) throw new TRPCError({ code: "FORBIDDEN", message });
    if (e.status === 404) throw new TRPCError({ code: "NOT_FOUND", message });
    if (e.status === 429) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message });
    if (e.status >= 500) throw new TRPCError({ code: "BAD_GATEWAY", message });
    throw new TRPCError({ code: "BAD_REQUEST", message });
  }
  // fetch() throws a TypeError when the host is unreachable / DNS fails / the
  // 25s outbound timeout aborts. Same class of condition as a 5xx.
  throw new TRPCError({
    code: "BAD_GATEWAY",
    message:
      "Não foi possível falar com o servidor da WAME. Confira o endereço do servidor e sua conexão, e tente de novo.",
  });
}

/** Resolve an instance the caller owns, or fail with a sentence they can act on. */
async function requireInstance(userId: string, id: string): Promise<q.Instance> {
  const instance = await q.getInstance(id, userId);
  if (!instance) throw new TRPCError({ code: "NOT_FOUND", message: "Instância não encontrada nesta conta." });
  return instance;
}

function target(instance: q.Instance): wame.WameTarget {
  return { serverUrl: instance.serverUrl, apiKey: instance.apiKey };
}

/** The shape every instance reaches the client in — never the raw row, which
 *  carries the full API key. */
function maskInstance(row: q.Instance) {
  return {
    id: row.id,
    label: row.label,
    serverUrl: row.serverUrl,
    apiKeyMasked: maskApiKey(row.apiKey),
    apiKeyHint: row.apiKey.slice(0, 4),
    phoneNumber: row.phoneNumber,
    profileName: row.profileName,
    webhookUrl: row.webhookUrl,
    webhookFormat: row.webhookFormat,
    isDefault: row.isDefault,
    lastStatus: row.lastStatus,
    lastStatusDetail: row.lastStatusDetail,
    lastCheckedAt: row.lastCheckedAt,
    createdAt: row.createdAt,
  };
}

// ── Instances ────────────────────────────────────────────────────────────────
const instancesRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const rows = await q.listInstances(ctx.user.id);
    return rows.map(maskInstance);
  }),

  create: protectedProcedure
    .input(
      z.object({
        label: z.string().trim().min(1).max(80),
        serverUrl: z.string().trim().url().max(300).optional(),
        apiKey: z.string().trim().min(8).max(400),
        webhookUrl: z.string().trim().url().max(500).optional(),
        webhookFormat: z.enum(["native", "meta", "both"]).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const row = await q.createInstance({
        userId: ctx.user.id,
        label: input.label,
        serverUrl: input.serverUrl || WAME_DEFAULT_SERVER,
        apiKey: input.apiKey,
        webhookUrl: input.webhookUrl ?? null,
        webhookFormat: input.webhookFormat ?? "native",
      });
      return maskInstance(row);
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.uuid(),
        label: z.string().trim().min(1).max(80).optional(),
        serverUrl: z.string().trim().url().max(300).optional(),
        // Omitted = keep the stored key. The UI never round-trips the real one.
        apiKey: z.string().trim().min(8).max(400).optional(),
        webhookUrl: z.string().trim().url().max(500).nullable().optional(),
        webhookFormat: z.enum(["native", "meta", "both"]).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...patch } = input;
      await requireInstance(ctx.user.id, id);
      const row = await q.updateInstance(id, ctx.user.id, patch);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Instância não encontrada nesta conta." });
      return maskInstance(row);
    }),

  remove: protectedProcedure
    .input(z.object({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      const ok = await q.deleteInstance(input.id, ctx.user.id);
      if (!ok) throw new TRPCError({ code: "NOT_FOUND", message: "Instância não encontrada nesta conta." });
      return { ok };
    }),

  /** Cheap connectivity check; also refreshes the cached state the shell shows. */
  health: protectedProcedure
    .input(z.object({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      const instance = await requireInstance(ctx.user.id, input.id);
      try {
        const health = await wame.instanceHealth(target(instance));
        await q.setInstanceStatus(instance.id, ctx.user.id, {
          state: health.state,
          detail: health.detail,
        });
        return { state: health.state, detail: health.detail, response: health.response };
      } catch (e) {
        // Keep the failure visible in the panel rather than only in a toast.
        if (e instanceof WameError) {
          await q.setInstanceStatus(instance.id, ctx.user.id, {
            state: "error",
            detail: e.message.slice(0, 200),
          });
        }
        return toTrpc(e);
      }
    }),

  details: protectedProcedure
    .input(z.object({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      const instance = await requireInstance(ctx.user.id, input.id);
      try {
        const response = await wame.instanceDetails(target(instance));
        return { response };
      } catch (e) {
        return toTrpc(e);
      }
    }),

  /** Start a QR Code connection and hand the image back for display. */
  qr: protectedProcedure
    .input(z.object({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      const instance = await requireInstance(ctx.user.id, input.id);
      try {
        const { qrImage, response } = await wame.connectWithQr(target(instance));
        if (!qrImage) {
          throw new TRPCError({
            code: "BAD_GATEWAY",
            message:
              "A WAME não devolveu a imagem do QR Code. A instância pode já estar conectada — use “Verificar conexão”.",
          });
        }
        await q.setInstanceStatus(instance.id, ctx.user.id, { state: "qr", detail: "QR Code gerado" });
        return { qrImage, response };
      } catch (e) {
        return toTrpc(e);
      }
    }),

  setWebhooks: protectedProcedure
    .input(
      z.object({
        id: z.uuid(),
        webhookUrl: z.string().trim().url().max(500).nullable(),
        webhookFormat: z.enum(["native", "meta", "both"]).default("native"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const instance = await requireInstance(ctx.user.id, input.id);
      try {
        const response = await wame.configureWebhooks(target(instance), {
          webhookUrl: input.webhookUrl,
          webhookFormat: input.webhookFormat,
        });
        await q.updateInstance(instance.id, ctx.user.id, {
          webhookUrl: input.webhookUrl,
          webhookFormat: input.webhookFormat,
        });
        return { response };
      } catch (e) {
        return toTrpc(e);
      }
    }),

  disconnect: protectedProcedure
    .input(z.object({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      const instance = await requireInstance(ctx.user.id, input.id);
      try {
        const response = await wame.disconnect(target(instance));
        await q.setInstanceStatus(instance.id, ctx.user.id, {
          state: "disconnected",
          detail: "Desconectado pelo painel",
        });
        return { response };
      } catch (e) {
        return toTrpc(e);
      }
    }),
});

// ── Status (the app's core operation) ────────────────────────────────────────
const statusRouter = router({
  /**
   * Publish a status. The provider call happens first, then the attempt is
   * recorded either way — a failed publication is exactly the row the operator
   * needs to see in the history in order to fix and retry it.
   */
  publish: protectedProcedure
    .input(
      z.object({
        instanceId: z.uuid(),
        kind: z.enum(STATUS_KINDS),
        caption: z.string().max(4000).optional(),
        mediaUrl: z.string().trim().max(2000).optional(),
        fileName: z.string().trim().max(200).optional(),
        mimeType: z.string().trim().max(100).optional(),
        audienceMode: z.enum(["all", "list"]).default("all"),
        contactIds: z.array(z.uuid()).max(1000).optional(),
        extraJids: z.array(z.string().trim().max(80)).max(1000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const instance = await requireInstance(ctx.user.id, input.instanceId);
      const mediaUrl = (input.mediaUrl ?? "").trim() || null;

      const invalid = validateStatusDraft({ kind: input.kind, caption: input.caption, mediaUrl });
      if (invalid) throw new TRPCError({ code: "BAD_REQUEST", message: invalid });

      // Resolve the audience. Only contacts owned by the caller can be picked;
      // a contact id from another account simply resolves to nothing.
      let jids: string[] | null = null;
      if (input.audienceMode === "list") {
        const fromContacts = await q.jidsForContactIds(ctx.user.id, input.contactIds ?? []);
        const fromText = (input.extraJids ?? [])
          .map((j) => normalizeJid(j))
          .filter((j): j is string => Boolean(j));
        jids = Array.from(new Set([...fromContacts, ...fromText]));
        if (jids.length === 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Escolha pelo menos um contato para ver o status, ou publique para todos.",
          });
        }
      }

      const caption = (input.caption ?? "").trim() || null;

      try {
        const result = await wame.publishStatus(target(instance), {
          kind: input.kind as StatusKind,
          caption,
          mediaUrl,
          jids,
        });
        const post = await q.createStatusPost({
          userId: ctx.user.id,
          instanceId: instance.id,
          kind: input.kind,
          caption,
          mediaUrl,
          fileName: input.fileName ?? null,
          mimeType: input.mimeType ?? null,
          audienceMode: input.audienceMode,
          statusJidList: jids,
          state: "published",
          providerMessageId: result.messageId,
          providerResponse: result.response,
          errorMessage: null,
        });
        return { ok: true as const, post };
      } catch (e) {
        const message =
          e instanceof WameError
            ? e.message
            : "Não foi possível falar com o servidor da WAME. Confira o endereço do servidor e sua conexão.";
        await q.createStatusPost({
          userId: ctx.user.id,
          instanceId: instance.id,
          kind: input.kind,
          caption,
          mediaUrl,
          fileName: input.fileName ?? null,
          mimeType: input.mimeType ?? null,
          audienceMode: input.audienceMode,
          statusJidList: jids,
          state: "failed",
          providerMessageId: null,
          providerResponse: e instanceof WameError ? e.payload : null,
          errorMessage: message.slice(0, 500),
        });
        return toTrpc(e);
      }
    }),

  list: protectedProcedure
    .input(
      z
        .object({
          kind: z.enum(STATUS_KINDS).optional(),
          state: z.enum(["published", "failed"]).optional(),
          limit: z.number().int().min(1).max(200).optional(),
        })
        .optional(),
    )
    .query(({ ctx, input }) => q.listStatusPosts(ctx.user.id, input ?? {})),

  stats: protectedProcedure.query(({ ctx }) => q.statusStats(ctx.user.id)),

  remove: protectedProcedure
    .input(z.object({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      const ok = await q.deleteStatusPost(input.id, ctx.user.id);
      if (!ok) throw new TRPCError({ code: "NOT_FOUND", message: "Publicação não encontrada." });
      return { ok };
    }),

  /** Mention a contact in a status that already went out. */
  mention: protectedProcedure
    .input(z.object({ id: z.uuid(), number: z.string().trim().min(8).max(80) }))
    .mutation(async ({ ctx, input }) => {
      const post = await q.getStatusPost(input.id, ctx.user.id);
      if (!post) throw new TRPCError({ code: "NOT_FOUND", message: "Publicação não encontrada." });
      if (!post.providerMessageId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "A WAME não devolveu o identificador desta publicação, então não é possível mencionar ninguém nela.",
        });
      }
      const jid = normalizeJid(input.number);
      if (!jid) throw new TRPCError({ code: "BAD_REQUEST", message: "Número inválido — use DDD + número." });
      const instance = await requireInstance(ctx.user.id, post.instanceId);
      try {
        const response = await wame.mentionInStatus(target(instance), {
          jid,
          statusMsgId: post.providerMessageId,
        });
        return { response };
      } catch (e) {
        return toTrpc(e);
      }
    }),
});

// ── Contacts ─────────────────────────────────────────────────────────────────
const contactsRouter = router({
  list: protectedProcedure
    .input(z.object({ q: z.string().trim().max(80).optional() }).optional())
    .query(({ ctx, input }) => q.listContacts(ctx.user.id, input ?? {})),

  count: protectedProcedure.query(({ ctx }) => q.countContacts(ctx.user.id)),

  /** Pull the instance's address book from the WAME API into our own table. */
  sync: protectedProcedure
    .input(z.object({ instanceId: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      const instance = await requireInstance(ctx.user.id, input.instanceId);
      try {
        const remote = await wame.listContacts(target(instance));
        const written = await q.upsertContacts(
          ctx.user.id,
          instance.id,
          remote.map((c) => ({ jid: c.jid, number: c.number, name: c.name })),
        );
        return { received: remote.length, written };
      } catch (e) {
        return toTrpc(e);
      }
    }),

  create: protectedProcedure
    .input(
      z.object({
        instanceId: z.uuid().optional(),
        number: z.string().trim().min(8).max(80),
        name: z.string().trim().max(120).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const jid = normalizeJid(input.number);
      if (!jid) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Número inválido — use DDD + número (ex.: 5511999999999)." });
      }
      try {
        return await q.createContact({
          userId: ctx.user.id,
          instanceId: input.instanceId ?? null,
          jid,
          number: jid.split("@")[0],
          name: input.name?.trim() || null,
        });
      } catch (e) {
        // The (userId, jid) unique index is what a double-add collides with.
        if (isUniqueViolation(e)) {
          throw new TRPCError({ code: "CONFLICT", message: "Esse contato já está na sua lista." });
        }
        throw e;
      }
    }),

  remove: protectedProcedure
    .input(z.object({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      const ok = await q.deleteContact(input.id, ctx.user.id);
      if (!ok) throw new TRPCError({ code: "NOT_FOUND", message: "Contato não encontrado." });
      return { ok };
    }),
});

// ── Media ────────────────────────────────────────────────────────────────────
// Browser-direct upload in three steps (the server never sees the bytes):
//   1. uploadUrl → signed PUT + the key to commit later
//   2. browser   → PUT the bytes
//   3. commit    → index it and record the public URL the WAME API will fetch
const mediaRouter = router({
  uploadUrl: protectedProcedure
    .input(z.object({ name: z.string().min(1).max(200), contentType: z.string().min(1).max(120) }))
    .mutation(async ({ ctx, input }) => {
      const key = `${crypto.randomUUID()}-${sanitizeBasename(input.name)}`;
      try {
        const { uploadUrl, publicPath } = await storagePutUrl(key, input.contentType, {
          ownerId: ctx.user.id,
        });
        return { key, uploadUrl, publicPath };
      } catch (e) {
        if (e instanceof StorageError && e.code === "failed") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "Tipo de arquivo recusado pelo armazenamento. Aceitos: JPG, PNG, WEBP, GIF, AVIF, MP4, WEBM, MP3 e WAV.",
          });
        }
        if (e instanceof StorageError && e.code === "not_configured") {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "O armazenamento deste app não está configurado.",
          });
        }
        throw e;
      }
    }),

  commit: protectedProcedure
    .input(
      z.object({
        key: z.string().min(1).max(400),
        name: z.string().min(1).max(200),
        kind: z.enum(["image", "video", "audio"]),
        publicUrl: z.string().trim().url().max(2000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      let record;
      try {
        record = await storageCommit(input.key, { ownerId: ctx.user.id, name: input.name });
      } catch (e) {
        if (e instanceof StorageError && e.code === "not_found") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "O upload não chegou ao armazenamento. Tente de novo." });
        }
        if (e instanceof StorageError && e.code === "forbidden") {
          throw new TRPCError({ code: "FORBIDDEN", message: "Essa chave pertence a outra conta." });
        }
        throw e;
      }
      const asset = await q.createMediaAsset({
        userId: ctx.user.id,
        fileName: input.name,
        storageKey: input.key,
        kind: input.kind,
        mimeType: record.contentType ?? null,
        sizeBytes: typeof record.size === "number" ? record.size : null,
        publicUrl: input.publicUrl,
      });
      return asset;
    }),

  list: protectedProcedure.query(({ ctx }) => q.listMediaAssets(ctx.user.id)),

  remove: protectedProcedure
    .input(z.object({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      const asset = await q.deleteMediaAsset(input.id, ctx.user.id);
      if (!asset) throw new TRPCError({ code: "NOT_FOUND", message: "Mídia não encontrada." });
      // Best-effort: the row is already gone, so a storage failure must not turn
      // a successful delete into an error the operator would retry.
      try {
        await storageDeleteOwned(ctx.user.id, asset.storageKey);
      } catch {
        /* orphan object, removable from the platform's storage panel */
      }
      return { ok: true };
    }),
});

// ── Direct messages ──────────────────────────────────────────────────────────
const messagesRouter = router({
  send: protectedProcedure
    .input(
      z.object({
        instanceId: z.uuid(),
        to: z.string().trim().min(8).max(80),
        kind: z.enum(["text", "image"]).default("text"),
        text: z.string().max(4000).optional(),
        mediaUrl: z.string().trim().max(2000).optional(),
        caption: z.string().max(1000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const instance = await requireInstance(ctx.user.id, input.instanceId);
      const jid = normalizeJid(input.to);
      // The message endpoints take a bare number; the API resolves the JID.
      const to = jid ? jid.split("@")[0] : input.to.replace(/[^0-9]/g, "");
      if (!to || to.length < 8) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Número inválido — use DDD + número." });
      }
      const text = (input.text ?? "").trim();
      const mediaUrl = (input.mediaUrl ?? "").trim();

      if (input.kind === "text" && !text) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Escreva a mensagem." });
      }
      if (input.kind === "image" && !mediaUrl) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Envie a imagem ou informe uma URL pública." });
      }

      try {
        const result =
          input.kind === "text"
            ? await wame.sendText(target(instance), { to, text })
            : await wame.sendImage(target(instance), { to, url: mediaUrl, caption: input.caption });
        await q.createMessageLog({
          userId: ctx.user.id,
          instanceId: instance.id,
          to,
          kind: input.kind,
          body: input.kind === "text" ? text : (input.caption ?? null),
          mediaUrl: input.kind === "image" ? mediaUrl : null,
          state: "sent",
          errorMessage: null,
          providerResponse: result.response,
        });
        return { ok: true as const, messageId: result.messageId };
      } catch (e) {
        const message =
          e instanceof WameError
            ? e.message
            : "Não foi possível falar com o servidor da WAME. Confira o endereço do servidor e sua conexão.";
        await q.createMessageLog({
          userId: ctx.user.id,
          instanceId: instance.id,
          to,
          kind: input.kind,
          body: input.kind === "text" ? text : (input.caption ?? null),
          mediaUrl: input.kind === "image" ? mediaUrl : null,
          state: "failed",
          errorMessage: message.slice(0, 500),
          providerResponse: e instanceof WameError ? e.payload : null,
        });
        return toTrpc(e);
      }
    }),

  list: protectedProcedure.query(({ ctx }) => q.listMessageLogs(ctx.user.id)),

  remove: protectedProcedure
    .input(z.object({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      const ok = await q.deleteMessageLog(input.id, ctx.user.id);
      if (!ok) throw new TRPCError({ code: "NOT_FOUND", message: "Registro não encontrado." });
      return { ok };
    }),
});

// ── Dashboard / shell ────────────────────────────────────────────────────────
const dashboardRouter = router({
  /** One round-trip for everything the shell and dashboard render. */
  overview: protectedProcedure.query(async ({ ctx }) => {
    const [instances, stats, recent, contactCount] = await Promise.all([
      q.listInstances(ctx.user.id),
      q.statusStats(ctx.user.id),
      q.listStatusPosts(ctx.user.id, { limit: 6 }),
      q.countContacts(ctx.user.id),
    ]);
    return {
      instances: instances.map(maskInstance),
      stats,
      recent,
      contactCount,
      hasMediaAssets: stats.total > 0,
    };
  }),
});

// Sanitize a caller-supplied filename down to a safe key BASENAME: take the
// last path segment (so "/../shared/report.pdf" can't steer the rest of the
// key), keep only [A-Za-z0-9._-], strip leading dots (so a survivor of "." or
// ".." can't slip through as a bare segment), and fall back to a fixed constant
// when nothing survives. Exported so it can be unit-tested directly.
//
// The stem and the extension are sanitized SEPARATELY, and that split is the
// whole point. Sanitizing the basename as one string used to destroy the
// extension of any file whose stem was entirely non-ASCII: the allowlist below
// deleted every CJK character in "风景.png", leaving ".png", and the leading-dot
// strip — there to kill "." / ".." / dotfiles — then ate the extension
// separator, because by that point it was the only dot left. The object landed
// in storage as "<uuid>-png". Splitting first means the leading-dot rule only
// ever sees the stem, where a leading dot really is a dotfile prefix.
export function sanitizeBasename(name: string): string {
  // Split on "\\" too: it cannot steer a path segment (the key joins on "/"),
  // but a Windows path would otherwise fold its directories into the stem.
  const last = name.split(/[/\\]/).pop() ?? "";
  // `> 0`, not `>= 0`: in ".gitignore" the dot is a dotfile prefix, not an
  // extension separator, so the whole name is the stem.
  const dot = last.lastIndexOf(".");
  const rawStem = dot > 0 ? last.slice(0, dot) : last;
  const rawExt = dot > 0 ? last.slice(dot + 1) : "";
  const stem = rawStem.replace(/[^A-Za-z0-9._-]/g, "").replace(/^\.+/, "") || "upload";
  // No dots or separators in an extension, and capped — the key is
  // `${uuid}-${basename}`, so a long tail buys nothing.
  const ext = rawExt.replace(/[^A-Za-z0-9]/g, "").slice(0, 10);
  return ext ? `${stem}.${ext}` : stem;
}

// The scaffold's plain storage surface, kept as-is: routers.test.ts exercises
// `files.remove`'s error mapping, and it is the generic upload path. The app's
// own `media` router below is what records an asset row for Status publishing.
const filesRouter = router({
  uploadUrl: protectedProcedure
    .input(z.object({ name: z.string().min(1), contentType: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const key = `${crypto.randomUUID()}-${sanitizeBasename(input.name)}`;
      try {
        const { uploadUrl, publicPath } = await storagePutUrl(key, input.contentType, {
          ownerId: ctx.user.id,
        });
        return { key, uploadUrl, publicPath };
      } catch (e) {
        if (e instanceof StorageError && e.code === "failed") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "Tipo de arquivo recusado pelo armazenamento. Aceitos: JPG, PNG, WEBP, GIF, AVIF, MP4, WEBM, MP3 e WAV.",
          });
        }
        if (e instanceof StorageError && e.code === "not_configured") {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "O armazenamento deste app não está configurado.",
          });
        }
        throw e;
      }
    }),

  commit: protectedProcedure
    .input(z.object({ key: z.string().min(1), name: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await storageCommit(input.key, { ownerId: ctx.user.id, name: input.name });
      } catch (e) {
        if (e instanceof StorageError && e.code === "not_found") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "O upload não chegou ao armazenamento. Tente de novo." });
        }
        if (e instanceof StorageError && e.code === "forbidden") {
          throw new TRPCError({ code: "FORBIDDEN", message: "Essa chave pertence a outra conta." });
        }
        throw e;
      }
    }),

  list: protectedProcedure.query(({ ctx }) => storageListByOwner(ctx.user.id)),

  remove: protectedProcedure
    .input(z.object({ key: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await storageDeleteOwned(ctx.user.id, input.key);
      } catch (e) {
        // A malformed key is bad client input, not a server fault: mapping it to
        // BAD_REQUEST keeps it a 400 the client can act on instead of an opaque
        // 500 wrapping a raw StorageError.
        if (e instanceof StorageError && e.code === "forbidden") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Chave de armazenamento inválida." });
        }
        throw e;
      }
    }),
});

export const appRouter = router({
  auth: authRouter,
  files: filesRouter,
  instances: instancesRouter,
  status: statusRouter,
  contacts: contactsRouter,
  media: mediaRouter,
  messages: messagesRouter,
  dashboard: dashboardRouter,
});

export type AppRouter = typeof appRouter;
