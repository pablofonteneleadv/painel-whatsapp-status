// ── AGENT-OWNED: business data-access ────────────────────────────────────────
// All raw Drizzle access lives here so procedures stay thin. EVERY function
// takes the owner id and filters on it — a row belonging to another account is
// neither readable nor writable through these helpers.
import { and, count, desc, eq, gte, ilike, inArray, or } from "drizzle-orm";
import { db } from "./_core/db";
import { contacts, mediaAssets, messageLogs, statusPosts, whatsappInstances } from "../drizzle/schema";

export type Instance = typeof whatsappInstances.$inferSelect;
export type StatusPost = typeof statusPosts.$inferSelect;
export type Contact = typeof contacts.$inferSelect;
export type MediaAsset = typeof mediaAssets.$inferSelect;
export type MessageLog = typeof messageLogs.$inferSelect;

const MAX_PAGE = 500;
function page(limit?: number, offset?: number) {
  return {
    limit: Math.max(1, Math.min(limit ?? 50, MAX_PAGE)),
    offset: Math.max(0, offset ?? 0),
  };
}

// ── Instances ───────────────────────────────────────────────────────────────

export async function listInstances(userId: string): Promise<Instance[]> {
  return db
    .select()
    .from(whatsappInstances)
    .where(eq(whatsappInstances.userId, userId))
    .orderBy(desc(whatsappInstances.isDefault), desc(whatsappInstances.createdAt));
}

export async function getInstance(id: string, userId: string): Promise<Instance | null> {
  const [row] = await db
    .select()
    .from(whatsappInstances)
    .where(and(eq(whatsappInstances.id, id), eq(whatsappInstances.userId, userId)))
    .limit(1);
  return row ?? null;
}

export async function createInstance(input: {
  userId: string;
  label: string;
  serverUrl: string;
  apiKey: string;
  webhookUrl: string | null;
  webhookFormat: string;
}): Promise<Instance> {
  const [row] = await db
    .insert(whatsappInstances)
    .values({
      userId: input.userId,
      label: input.label,
      serverUrl: input.serverUrl,
      apiKey: input.apiKey,
      webhookUrl: input.webhookUrl,
      webhookFormat: input.webhookFormat,
      isDefault: true,
    })
    .returning();
  return row;
}

/** Owner-scoped update. A patch with no recognised field is a no-op, not a
 *  blanket write — an accidental empty object must not blank the row. */
export async function updateInstance(
  id: string,
  userId: string,
  patch: Partial<{
    label: string;
    serverUrl: string;
    apiKey: string;
    webhookUrl: string | null;
    webhookFormat: string;
  }>,
): Promise<Instance | null> {
  const set: Record<string, unknown> = {};
  if (patch.label !== undefined) set.label = patch.label;
  if (patch.serverUrl !== undefined) set.serverUrl = patch.serverUrl;
  if (patch.apiKey !== undefined) set.apiKey = patch.apiKey;
  if (patch.webhookUrl !== undefined) set.webhookUrl = patch.webhookUrl;
  if (patch.webhookFormat !== undefined) set.webhookFormat = patch.webhookFormat;
  if (Object.keys(set).length === 0) return getInstance(id, userId);
  const [row] = await db
    .update(whatsappInstances)
    .set(set)
    .where(and(eq(whatsappInstances.id, id), eq(whatsappInstances.userId, userId)))
    .returning();
  return row ?? null;
}

/** Record the outcome of a connection check so the UI can show it without a
 *  fresh provider call on every page load. */
export async function setInstanceStatus(
  id: string,
  userId: string,
  input: { state: string; detail: string | null; phoneNumber?: string | null; profileName?: string | null },
): Promise<void> {
  const set: Record<string, unknown> = {
    lastStatus: input.state,
    lastStatusDetail: input.detail,
    lastCheckedAt: new Date(),
  };
  if (input.phoneNumber !== undefined) set.phoneNumber = input.phoneNumber;
  if (input.profileName !== undefined) set.profileName = input.profileName;
  await db
    .update(whatsappInstances)
    .set(set)
    .where(and(eq(whatsappInstances.id, id), eq(whatsappInstances.userId, userId)));
}

export async function deleteInstance(id: string, userId: string): Promise<boolean> {
  const removed = await db
    .delete(whatsappInstances)
    .where(and(eq(whatsappInstances.id, id), eq(whatsappInstances.userId, userId)))
    .returning();
  return removed.length > 0;
}

// ── Status posts ────────────────────────────────────────────────────────────

export async function listStatusPosts(
  userId: string,
  filter: { kind?: string; state?: string; limit?: number; offset?: number } = {},
): Promise<StatusPost[]> {
  const { limit, offset } = page(filter.limit, filter.offset);
  const where = [eq(statusPosts.userId, userId)];
  if (filter.kind) where.push(eq(statusPosts.kind, filter.kind));
  if (filter.state) where.push(eq(statusPosts.state, filter.state));
  return db
    .select()
    .from(statusPosts)
    .where(and(...where))
    .orderBy(desc(statusPosts.createdAt))
    .limit(limit)
    .offset(offset);
}

export async function getStatusPost(id: string, userId: string): Promise<StatusPost | null> {
  const [row] = await db
    .select()
    .from(statusPosts)
    .where(and(eq(statusPosts.id, id), eq(statusPosts.userId, userId)))
    .limit(1);
  return row ?? null;
}

export async function createStatusPost(input: {
  userId: string;
  instanceId: string;
  kind: string;
  caption: string | null;
  mediaUrl: string | null;
  fileName: string | null;
  mimeType: string | null;
  audienceMode: string;
  statusJidList: string[] | null;
  state: string;
  providerMessageId: string | null;
  providerResponse: unknown;
  errorMessage: string | null;
}): Promise<StatusPost> {
  const [row] = await db
    .insert(statusPosts)
    .values({
      userId: input.userId,
      instanceId: input.instanceId,
      kind: input.kind,
      caption: input.caption,
      mediaUrl: input.mediaUrl,
      fileName: input.fileName,
      mimeType: input.mimeType,
      audienceMode: input.audienceMode,
      statusJidList: input.statusJidList,
      state: input.state,
      providerMessageId: input.providerMessageId,
      providerResponse: (input.providerResponse ?? null) as never,
      errorMessage: input.errorMessage,
      publishedAt: input.state === "published" ? new Date() : null,
    })
    .returning();
  return row;
}

export async function deleteStatusPost(id: string, userId: string): Promise<boolean> {
  const removed = await db
    .delete(statusPosts)
    .where(and(eq(statusPosts.id, id), eq(statusPosts.userId, userId)))
    .returning();
  return removed.length > 0;
}

/** Derived counters for the dashboard and the composer header. */
export async function statusStats(userId: string): Promise<{
  total: number;
  published: number;
  failed: number;
  last7Days: number;
  byKind: Record<string, number>;
}> {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [totals, recent, kinds] = await Promise.all([
    db
      .select({ state: statusPosts.state, value: count() })
      .from(statusPosts)
      .where(eq(statusPosts.userId, userId))
      .groupBy(statusPosts.state),
    db
      .select({ value: count() })
      .from(statusPosts)
      .where(and(eq(statusPosts.userId, userId), gte(statusPosts.createdAt, since))),
    db
      .select({ kind: statusPosts.kind, value: count() })
      .from(statusPosts)
      .where(eq(statusPosts.userId, userId))
      .groupBy(statusPosts.kind),
  ]);

  const byState: Record<string, number> = {};
  for (const row of totals) byState[row.state] = Number(row.value);
  const byKind: Record<string, number> = {};
  for (const row of kinds) byKind[row.kind] = Number(row.value);

  const published = byState.published ?? 0;
  const failed = byState.failed ?? 0;
  return {
    total: published + failed,
    published,
    failed,
    last7Days: Number(recent[0]?.value ?? 0),
    byKind,
  };
}

// ── Contacts ────────────────────────────────────────────────────────────────

export async function listContacts(
  userId: string,
  filter: { q?: string; limit?: number } = {},
): Promise<Contact[]> {
  const limit = Math.max(1, Math.min(filter.limit ?? 500, MAX_PAGE));
  const where = [eq(contacts.userId, userId)];
  const q = filter.q?.trim();
  if (q) {
    const like = `%${q.replace(/[%_]/g, "")}%`;
    const match = or(ilike(contacts.name, like), ilike(contacts.number, like), ilike(contacts.jid, like));
    if (match) where.push(match);
  }
  return db
    .select()
    .from(contacts)
    .where(and(...where))
    .orderBy(desc(contacts.syncedAt), desc(contacts.createdAt))
    .limit(limit);
}

export async function countContacts(userId: string): Promise<number> {
  const [row] = await db.select({ value: count() }).from(contacts).where(eq(contacts.userId, userId));
  return Number(row?.value ?? 0);
}

/**
 * Upsert a synced batch. The (userId, jid) unique index makes this safe to run
 * repeatedly: an existing contact is refreshed in place, a new one is inserted.
 * Returns the number of rows written.
 */
export async function upsertContacts(
  userId: string,
  instanceId: string,
  rows: { jid: string; number: string | null; name: string | null }[],
): Promise<number> {
  if (rows.length === 0) return 0;
  const now = new Date();
  const values = rows.map((r) => ({
    userId,
    instanceId,
    jid: r.jid,
    number: r.number,
    name: r.name,
    source: "synced",
    syncedAt: now,
  }));
  const inserted = await db
    .insert(contacts)
    .values(values)
    .onConflictDoUpdate({
      target: [contacts.userId, contacts.jid],
      set: {
        number: sqlExcluded("number"),
        name: sqlExcluded("name"),
        instanceId: sqlExcluded("instance_id"),
        syncedAt: now,
        source: "synced",
      },
    })
    .returning();
  return inserted.length;
}

// Only the excluded-row reference needs raw SQL; keep it in one place so the
// column names stay quoted exactly as Postgres stores them.
import { sql } from "drizzle-orm";
function sqlExcluded(column: string) {
  return sql.raw(`excluded.${column}`);
}

export async function createContact(input: {
  userId: string;
  instanceId: string | null;
  jid: string;
  number: string | null;
  name: string | null;
}): Promise<Contact> {
  const [row] = await db
    .insert(contacts)
    .values({
      userId: input.userId,
      instanceId: input.instanceId,
      jid: input.jid,
      number: input.number,
      name: input.name,
      source: "manual",
      syncedAt: new Date(),
    })
    .returning();
  return row;
}

export async function deleteContact(id: string, userId: string): Promise<boolean> {
  const removed = await db
    .delete(contacts)
    .where(and(eq(contacts.id, id), eq(contacts.userId, userId)))
    .returning();
  return removed.length > 0;
}

/** Resolve a set of contact ids to JIDs, scoped to the owner. */
export async function jidsForContactIds(userId: string, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .select({ jid: contacts.jid })
    .from(contacts)
    .where(and(eq(contacts.userId, userId), inArray(contacts.id, ids)));
  return rows.map((r) => r.jid);
}

// ── Media assets ────────────────────────────────────────────────────────────

export async function listMediaAssets(userId: string, limit = 100): Promise<MediaAsset[]> {
  return db
    .select()
    .from(mediaAssets)
    .where(eq(mediaAssets.userId, userId))
    .orderBy(desc(mediaAssets.createdAt))
    .limit(Math.max(1, Math.min(limit, MAX_PAGE)));
}

export async function createMediaAsset(input: {
  userId: string;
  fileName: string;
  storageKey: string;
  kind: string;
  mimeType: string | null;
  sizeBytes: number | null;
  publicUrl: string;
}): Promise<MediaAsset> {
  const [row] = await db.insert(mediaAssets).values(input).returning();
  return row;
}

export async function getMediaAsset(id: string, userId: string): Promise<MediaAsset | null> {
  const [row] = await db
    .select()
    .from(mediaAssets)
    .where(and(eq(mediaAssets.id, id), eq(mediaAssets.userId, userId)))
    .limit(1);
  return row ?? null;
}

export async function deleteMediaAsset(id: string, userId: string): Promise<MediaAsset | null> {
  const [row] = await db
    .delete(mediaAssets)
    .where(and(eq(mediaAssets.id, id), eq(mediaAssets.userId, userId)))
    .returning();
  return row ?? null;
}

// ── Message logs ────────────────────────────────────────────────────────────

export async function listMessageLogs(userId: string, limit = 100): Promise<MessageLog[]> {
  return db
    .select()
    .from(messageLogs)
    .where(eq(messageLogs.userId, userId))
    .orderBy(desc(messageLogs.createdAt))
    .limit(Math.max(1, Math.min(limit, MAX_PAGE)));
}

export async function createMessageLog(input: {
  userId: string;
  instanceId: string;
  to: string;
  kind: string;
  body: string | null;
  mediaUrl: string | null;
  state: string;
  errorMessage: string | null;
  providerResponse: unknown;
}): Promise<MessageLog> {
  const [row] = await db
    .insert(messageLogs)
    .values({ ...input, providerResponse: (input.providerResponse ?? null) as never })
    .returning();
  return row;
}

export async function deleteMessageLog(id: string, userId: string): Promise<boolean> {
  const removed = await db
    .delete(messageLogs)
    .where(and(eq(messageLogs.id, id), eq(messageLogs.userId, userId)))
    .returning();
  return removed.length > 0;
}
