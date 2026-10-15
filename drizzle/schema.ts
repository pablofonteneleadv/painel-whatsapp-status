import { pgTable, uuid, text, timestamp, index, bigint, integer, boolean, jsonb, uniqueIndex } from "drizzle-orm/pg-core";

// ──────────────────────────────────────────────────────────────────────────────
// SYSTEM TABLE — managed by the scaffold. The Agent MUST NOT redefine or drop
// the auth columns here; it only ADDS business tables below (DESIGN §5.1).
//
// `password_hash` is LOCAL-auth-only. It is deliberately confined to this table
// and to server/_core/auth.ts — it never appears in SessionUser or any tRPC
// output. A future SsoAuthProvider would leave it null and link identities via
// an external-subject column; business tables keep FK'ing users.id regardless,
// so switching auth providers needs no business-schema change.
// ──────────────────────────────────────────────────────────────────────────────
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash"), // null for SSO-linked users (future)
  name: text("name"),
  role: text("role").notNull().default("user"), // 'user' | 'admin'
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// SYSTEM TABLE — managed by the scaffold, written by server/_core/storage.ts.
// The Agent MUST NOT redefine, rename or drop it: `_core` inserts into it, so a
// rename breaks `_core`. Rows are created by storageCommit() AFTER the upload
// landed, with size/contentType read back from object storage — never from the
// client — so a row cannot point at an object that does not exist AT COMMIT TIME.
//
// That guarantee can still go stale: the platform's owner-facing storage panel
// can delete the underlying object directly. It has no access to this app's
// database, so it cannot (and does not) delete the matching row here. A row
// existing is therefore NOT a guarantee its object still exists — treat a 404
// from `/app-storage/<key>` as an expected, handle-able case in the UI, not a
// bug. `/app-storage/<key>` is also unauthenticated (no session check), so the
// URL itself is the read capability — never store something there that must
// not leak to anyone who obtains the link.
export const files = pgTable(
  "files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Path relative to this app's storage prefix; served at /app-storage/<key>.
    key: text("key").notNull().unique(),
    // Nullable on purpose: a public "contact form with attachment" has no
    // logged-in uploader. set null (not cascade) on user delete — this table is
    // the app's ONLY index of its objects, so deleting the row would
    // permanently lose the ability to find the file.
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
    name: text("name").notNull(),                        // original filename, for display
    size: bigint("size", { mode: "number" }).notNull(),  // bigint: integer caps at ~2.1GB
    contentType: text("content_type"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("files_owner_idx").on(t.ownerId), index("files_created_idx").on(t.createdAt)],
);

// ──────────────────────────────────────────────────────────────────────────────
// BUSINESS TABLES — WhatsApp instance management + Status publishing (WAME API)
//
// One operator per account. Every table carries `userId` and every query in
// server/db.ts filters by it. The WAME API key is a SERVER-ONLY secret: it is
// stored here (so the operator can configure it from the UI), but it is never
// returned in the clear — routers mask it before it reaches the client.
// ──────────────────────────────────────────────────────────────────────────────

// A connected (or to-be-connected) WAME instance. `apiKey` is the `{key}` path
// segment of every WAME endpoint: https://server.wame.api.br/{key}/...
export const whatsappInstances = pgTable(
  "whatsapp_instances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    label: text("label").notNull().default("Minha instância"),
    serverUrl: text("server_url").notNull().default("https://server.wame.api.br"),
    apiKey: text("api_key").notNull(),
    // Phone number / profile name as reported by the API (informational).
    phoneNumber: text("phone_number"),
    profileName: text("profile_name"),
    // Webhook configuration (PUT /{key}/instance).
    webhookUrl: text("webhook_url"),
    webhookFormat: text("webhook_format").notNull().default("native"), // native | meta | both
    isDefault: boolean("is_default").notNull().default(true),
    // Cached connection state, refreshed on demand (GET /{key}/instance/health).
    lastStatus: text("last_status").notNull().default("unknown"), // connected|disconnected|qr|error|unknown
    lastStatusDetail: text("last_status_detail"),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("whatsapp_instances_user_idx").on(t.userId)],
);

// One publication to Status (stories). Image/video are the primary kinds;
// text and audio are supported by the same API surface.
export const statusPosts = pgTable(
  "status_posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    instanceId: uuid("instance_id")
      .notNull()
      .references(() => whatsappInstances.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // image | video | text | audio
    caption: text("caption"),
    mediaUrl: text("media_url"), // public URL handed to the WAME API
    fileName: text("file_name"),
    mimeType: text("mime_type"),
    audienceMode: text("audience_mode").notNull().default("all"), // all | list
    statusJidList: jsonb("status_jid_list").$type<string[]>(),
    captionValid: boolean("caption_valid").notNull().default(true),
    state: text("state").notNull().default("published"), // published | failed
    providerMessageId: text("provider_message_id"),
    providerResponse: jsonb("provider_response"),
    errorMessage: text("error_message"),
    // Whole-wall seconds the provider has left for this publication, when known.
    expiresInSeconds: integer("expires_in_seconds"),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("status_posts_user_idx").on(t.userId),
    index("status_posts_user_created_idx").on(t.userId, t.createdAt),
  ],
);

// Contacts pulled from the instance (GET /{key}/contacts) and/or typed in by the
// operator as Status audience members. JID is the audience unit the API expects.
export const contacts = pgTable(
  "contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    instanceId: uuid("instance_id").references(() => whatsappInstances.id, { onDelete: "cascade" }),
    jid: text("jid").notNull(), // 5511999999999@s.whatsapp.net
    number: text("number"),
    name: text("name"),
    source: text("source").notNull().default("synced"), // synced | manual
    syncedAt: timestamp("synced_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("contacts_user_idx").on(t.userId),
    uniqueIndex("contacts_user_jid_idx").on(t.userId, t.jid),
  ],
);

// An image/video/audio the operator uploaded. `publicUrl` is the absolute
// /app-storage URL handed to the WAME API as the status `url`.
export const mediaAssets = pgTable(
  "media_assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    fileName: text("file_name").notNull(),
    storageKey: text("storage_key").notNull(),
    kind: text("kind").notNull(), // image | video | audio
    mimeType: text("mime_type"),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    publicUrl: text("public_url").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("media_assets_user_idx").on(t.userId), index("media_assets_user_created_idx").on(t.userId, t.createdAt)],
);

// Direct messages sent through the instance (text and image) — the secondary
// surface of the panel, kept for operator traceability.
export const messageLogs = pgTable(
  "message_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    instanceId: uuid("instance_id")
      .notNull()
      .references(() => whatsappInstances.id, { onDelete: "cascade" }),
    to: text("to").notNull(),
    kind: text("kind").notNull().default("text"), // text | image
    body: text("body"),
    mediaUrl: text("media_url"),
    state: text("state").notNull().default("sent"), // sent | failed
    errorMessage: text("error_message"),
    providerResponse: jsonb("provider_response"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("message_logs_user_idx").on(t.userId), index("message_logs_user_created_idx").on(t.userId, t.createdAt)],
);
