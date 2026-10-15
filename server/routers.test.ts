// Business-router tests: owner scoping, the WAME Status publication path (the
// app's core operation), and the provider-failure contract.
//
// What is mocked, and why — this mirrors server/_core/test-caller.ts:
//   * every _core leaf that touches env or a driver at IMPORT time must be
//     mocked (./_core/auth, ./_core/storage, ./_core/db), because routers.ts
//     imports them and ./_core/db reads DATABASE_URL at module load;
//   * the business data layer (./db) is mocked because its queries need a real
//     Postgres — but ./_core/trpc is left REAL, so the caller exercises the
//     actual procedure definitions and input validation;
//   * ./_core/fetch is mocked, and that is deliberate: it is the ONLY thing
//     between server/services/wame.ts and the network. Mocking it means the
//     real service runs — real URL construction, real body building, real
//     error mapping — instead of a re-implementation of it.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import { makeCaller } from "./_core/test-caller";

vi.mock("./_core/auth", () => {
  class AuthError extends Error {}
  return {
    authProvider: () => ({ login: vi.fn(), logout: vi.fn(), getSession: vi.fn() }),
    registerLocalUser: vi.fn(),
    AuthError,
    EmailTakenError: class EmailTakenError extends AuthError {},
  };
});

vi.mock("./_core/storage", () => ({
  storageCommit: vi.fn(),
  storageDeleteOwned: vi.fn(),
  storageListByOwner: vi.fn(),
  storagePutUrl: vi.fn(),
  StorageError: class StorageError extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.code = code;
    }
  },
}));

// routers.ts imports `isUniqueViolation` from ./_core/db, and that module reads
// env at load — so this leaf needs its own mock, not just the business layer.
vi.mock("./_core/db", () => ({ isUniqueViolation: vi.fn(() => false) }));

vi.mock("./db", () => ({
  listInstances: vi.fn(),
  getInstance: vi.fn(),
  createInstance: vi.fn(),
  updateInstance: vi.fn(),
  setInstanceStatus: vi.fn(),
  deleteInstance: vi.fn(),
  listStatusPosts: vi.fn(),
  getStatusPost: vi.fn(),
  createStatusPost: vi.fn(),
  deleteStatusPost: vi.fn(),
  statusStats: vi.fn(),
  listContacts: vi.fn(),
  countContacts: vi.fn(),
  upsertContacts: vi.fn(),
  createContact: vi.fn(),
  deleteContact: vi.fn(),
  jidsForContactIds: vi.fn(),
  listMediaAssets: vi.fn(),
  createMediaAsset: vi.fn(),
  deleteMediaAsset: vi.fn(),
  listMessageLogs: vi.fn(),
  createMessageLog: vi.fn(),
  deleteMessageLog: vi.fn(),
}));

vi.mock("./_core/fetch", () => ({ outboundFetch: vi.fn() }));

const { sanitizeBasename } = await import("./routers");
const { registerLocalUser, EmailTakenError } = await import("./_core/auth");

// Both of these are mocked modules, so their inferred types describe the REAL
// module. Narrowing them to a bag of vi.fn() keeps every call below typed
// without a cast on each line.
const db = (await import("./db")) as unknown as Record<string, ReturnType<typeof vi.fn>>;
const http = (await import("./_core/fetch")) as unknown as Record<
  string,
  ReturnType<typeof vi.fn>
>;

// `z.uuid()` is on every id in the input schemas, so these must be real UUIDs —
// a string like "inst-1" would be rejected by validation before the code under
// test ever ran, and the test would pass for the wrong reason.
const USER_ID = "22222222-2222-4222-8222-222222222222";
const INSTANCE_ID = "11111111-1111-4111-8111-111111111111";
const CONTACT_ID = "44444444-4444-4444-8444-444444444444";

const API_KEY = "abcd1234efgh";
const WAME_HOST = "https://server.wame.api.br";

const INSTANCE = {
  id: INSTANCE_ID,
  userId: USER_ID,
  label: "Loja Centro",
  serverUrl: WAME_HOST,
  apiKey: API_KEY,
  phoneNumber: null,
  profileName: null,
  webhookUrl: null,
  webhookFormat: "native",
  isDefault: true,
  lastStatus: "unknown",
  lastStatusDetail: null,
  lastCheckedAt: null,
  createdAt: new Date("2026-10-01T10:00:00Z"),
};

function caller(user: { id: string } | null = { id: USER_ID }) {
  return makeCaller({ c: {} as never, db: {} as never, user: user as never });
}

/** The fake Response shape server/services/wame.ts consumes. */
function reply(status: number, payload: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload),
  };
}

/** Inspect the request the service actually issued. */
function lastCall() {
  const [url, init] = http.outboundFetch.mock.calls.at(-1) as [string, RequestInit];
  const body = init.body ? JSON.parse(String(init.body)) : null;
  return { url, init, body };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.getInstance.mockResolvedValue(INSTANCE);
  // Echo the row the router asked us to persist, so assertions can read it back.
  db.createStatusPost.mockImplementation(async (v: unknown) => v);
  db.createMessageLog.mockImplementation(async (v: unknown) => v);
});

// ── status.publish: the operation the whole panel exists for ─────────────────

describe("status.publish", () => {
  it("POSTs an image to /{key}/status/image and omits statusJidList for \"todos\"", async () => {
    http.outboundFetch.mockResolvedValue(reply(200, { statusMsgId: "MSG-1" }));

    const res = await caller().status.publish({
      instanceId: INSTANCE_ID,
      kind: "image",
      caption: "Coleção nova chegou",
      mediaUrl: "https://cdn.example.com/a.jpg",
      audienceMode: "all",
    });

    expect(res.ok).toBe(true);
    const { url, init, body } = lastCall();
    expect(url).toBe(`${WAME_HOST}/${API_KEY}/status/image`);
    expect(init.method).toBe("POST");
    expect(body).toEqual({
      url: "https://cdn.example.com/a.jpg",
      caption: "Coleção nova chegou",
    });
    // Omitting the list is what makes the API fall back to the instance's own
    // privacy setting; sending an empty array would publish to nobody.
    expect(body).not.toHaveProperty("statusJidList");
    expect(db.createStatusPost).toHaveBeenCalledWith(
      expect.objectContaining({ state: "published", providerMessageId: "MSG-1" }),
    );
  });

  it("POSTs a video with its caption and records the publication", async () => {
    http.outboundFetch.mockResolvedValue(reply(200, { data: { id: "VID-7" } }));

    const res = await caller().status.publish({
      instanceId: INSTANCE_ID,
      kind: "video",
      caption: "Bastidores",
      mediaUrl: "https://cdn.example.com/clip.mp4",
      audienceMode: "all",
      fileName: "clip.mp4",
      mimeType: "video/mp4",
    });

    expect(res.ok).toBe(true);
    const { url, body } = lastCall();
    expect(url).toBe(`${WAME_HOST}/${API_KEY}/status/video`);
    expect(body).toEqual({ url: "https://cdn.example.com/clip.mp4", caption: "Bastidores" });
    expect(db.createStatusPost).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "video", fileName: "clip.mp4", state: "published" }),
    );
  });

  it("sends statusJidList only when the audience is narrowed, resolving contacts to JIDs", async () => {
    http.outboundFetch.mockResolvedValue(reply(200, { statusMsgId: "MSG-2" }));
    db.jidsForContactIds.mockResolvedValue(["5511999999999@s.whatsapp.net"]);

    await caller().status.publish({
      instanceId: INSTANCE_ID,
      kind: "image",
      caption: "Só para clientes",
      mediaUrl: "https://cdn.example.com/b.jpg",
      audienceMode: "list",
      contactIds: [CONTACT_ID],
      extraJids: ["+55 (11) 98888-7777"],
    });

    // Contacts are resolved owner-scoped, and a hand-typed number is normalised
    // into the JID form the API expects.
    expect(db.jidsForContactIds).toHaveBeenCalledWith(USER_ID, [CONTACT_ID]);
    const { body } = lastCall();
    expect(body.statusJidList).toEqual([
      "5511999999999@s.whatsapp.net",
      "5511988887777@s.whatsapp.net",
    ]);
  });

  it("refuses a narrowed audience that resolves to nobody", async () => {
    db.jidsForContactIds.mockResolvedValue([]);

    const err = await caller()
      .status.publish({
        instanceId: INSTANCE_ID,
        kind: "image",
        mediaUrl: "https://cdn.example.com/c.jpg",
        audienceMode: "list",
        contactIds: [],
      })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(TRPCError);
    expect((err as TRPCError).code).toBe("BAD_REQUEST");
    // Nothing was published, so no provider call and no audit row.
    expect(http.outboundFetch).not.toHaveBeenCalled();
    expect(db.createStatusPost).not.toHaveBeenCalled();
  });

  it("omits the caption for an audio status, which has no caption field", async () => {
    http.outboundFetch.mockResolvedValue(reply(200, { statusMsgId: "MSG-3" }));

    await caller().status.publish({
      instanceId: INSTANCE_ID,
      kind: "audio",
      caption: "isto não deve ser enviado",
      mediaUrl: "https://cdn.example.com/voice.mp3",
      audienceMode: "all",
    });

    const { body } = lastCall();
    expect(body).toEqual({ url: "https://cdn.example.com/voice.mp3" });
  });

  it("rejects a media status with no media before touching the network", async () => {
    const err = await caller()
      .status.publish({ instanceId: INSTANCE_ID, kind: "image", caption: "sem arquivo" })
      .catch((e: unknown) => e);

    expect((err as TRPCError).code).toBe("BAD_REQUEST");
    expect(http.outboundFetch).not.toHaveBeenCalled();
  });

  it("records the attempt as FAILED and maps a 401 to FORBIDDEN, so the history can explain it", async () => {
    http.outboundFetch.mockResolvedValue(reply(401, { message: "invalid api key" }));

    const err = await caller()
      .status.publish({
        instanceId: INSTANCE_ID,
        kind: "image",
        caption: "não vai sair",
        mediaUrl: "https://cdn.example.com/d.jpg",
        audienceMode: "all",
      })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(TRPCError);
    expect((err as TRPCError).code).toBe("FORBIDDEN");
    // A failed publication is exactly the row the operator needs to see.
    expect(db.createStatusPost).toHaveBeenCalledWith(
      expect.objectContaining({
        state: "failed",
        providerMessageId: null,
        errorMessage: expect.any(String),
      }),
    );
  });

  it("refuses an instance that belongs to another account", async () => {
    db.getInstance.mockResolvedValue(null);

    const err = await caller()
      .status.publish({
        instanceId: INSTANCE_ID,
        kind: "image",
        mediaUrl: "https://cdn.example.com/e.jpg",
        audienceMode: "all",
      })
      .catch((e: unknown) => e);

    expect((err as TRPCError).code).toBe("NOT_FOUND");
    expect(http.outboundFetch).not.toHaveBeenCalled();
  });
});

// ── instance health ─────────────────────────────────────────────────────────

describe("instances.health", () => {
  it("reads the connection state, caches it, and never returns the API key", async () => {
    http.outboundFetch.mockResolvedValue(reply(200, { state: "open", instance: { connected: true } }));
    db.setInstanceStatus.mockResolvedValue(undefined);

    const res = await caller().instances.health({ id: INSTANCE_ID });

    expect(res.state).toBe("connected");
    expect(lastCall().url).toBe(`${WAME_HOST}/${API_KEY}/instance/health`);
    expect(db.setInstanceStatus).toHaveBeenCalledWith(
      INSTANCE_ID,
      USER_ID,
      expect.objectContaining({ state: "connected" }),
    );
    expect(JSON.stringify(res)).not.toContain(API_KEY);
  });

  it("keeps a provider failure visible in the panel instead of only raising", async () => {
    http.outboundFetch.mockResolvedValue(reply(404, { message: "instance not found" }));
    db.setInstanceStatus.mockResolvedValue(undefined);

    const err = await caller()
      .instances.health({ id: INSTANCE_ID })
      .catch((e: unknown) => e);

    expect((err as TRPCError).code).toBe("NOT_FOUND");
    expect(db.setInstanceStatus).toHaveBeenCalledWith(
      INSTANCE_ID,
      USER_ID,
      expect.objectContaining({ state: "error" }),
    );
  });

  it("masks the API key on every instance the client receives", async () => {
    db.listInstances.mockResolvedValue([INSTANCE]);

    const rows = await caller().instances.list();

    expect(rows[0].apiKeyMasked).toBe(`abcd••••••gh`);
    expect(JSON.stringify(rows)).not.toContain(API_KEY);
  });
});

// ── contacts ────────────────────────────────────────────────────────────────

describe("contacts.sync", () => {
  it("pulls the address book and upserts it owner-scoped", async () => {
    http.outboundFetch.mockResolvedValue(
      reply(200, {
        contacts: [
          { jid: "5511911111111@s.whatsapp.net", name: "Ana" },
          { id: "5511922222222", pushName: "Bruno" },
          { jid: "not-a-number" },
        ],
      }),
    );
    db.upsertContacts.mockResolvedValue(2);

    const res = await caller().contacts.sync({ instanceId: INSTANCE_ID });

    expect(lastCall().url).toBe(`${WAME_HOST}/${API_KEY}/contacts`);
    // The malformed entry is dropped, not stored as a fake contact.
    expect(res).toEqual({ received: 2, written: 2 });
    expect(db.upsertContacts).toHaveBeenCalledWith(
      USER_ID,
      INSTANCE_ID,
      [
        { jid: "5511911111111@s.whatsapp.net", number: "5511911111111", name: "Ana" },
        { jid: "5511922222222@s.whatsapp.net", number: "5511922222222", name: "Bruno" },
      ],
    );
  });

  it("refuses an invalid number when adding a contact by hand", async () => {
    const err = await caller()
      .contacts.create({ number: "123" })
      .catch((e: unknown) => e);

    expect((err as TRPCError).code).toBe("BAD_REQUEST");
    expect(db.createContact).not.toHaveBeenCalled();
  });
});

// ── media upload signing ────────────────────────────────────────────────────

describe("media.uploadUrl", () => {
  it("signs a key that cannot escape its own prefix", async () => {
    const { storagePutUrl } = await import("./_core/storage");
    vi.mocked(storagePutUrl).mockResolvedValue({
      uploadUrl: "https://storage.example.com/signed",
      publicPath: "/app-storage/abc.jpg",
    } as never);

    const res = await caller().media.uploadUrl({
      name: "../../etc/passwd.jpg",
      contentType: "image/jpeg",
    });

    expect(res.key).toMatch(/^[0-9a-f-]{36}-passwd\.jpg$/);
    expect(res.key).not.toContain("/");
    expect(res.key).not.toContain("..");
  });
});

// ── direct messages ─────────────────────────────────────────────────────────

describe("messages.send", () => {
  it("sends a text message with the bare number the endpoint expects", async () => {
    http.outboundFetch.mockResolvedValue(reply(200, { messageId: "W-1" }));

    const res = await caller().messages.send({
      instanceId: INSTANCE_ID,
      to: "+55 (11) 98888-7777",
      kind: "text",
      text: "Olá!",
    });

    expect(res).toEqual({ ok: true, messageId: "W-1" });
    const { url, body } = lastCall();
    expect(url).toBe(`${WAME_HOST}/${API_KEY}/message/text`);
    expect(body).toEqual({ to: "5511988887777", text: "Olá!", provider: "whatsapp" });
    expect(db.createMessageLog).toHaveBeenCalledWith(
      expect.objectContaining({ state: "sent", to: "5511988887777" }),
    );
  });

  it("logs a failed send rather than losing it", async () => {
    http.outboundFetch.mockResolvedValue(reply(500, { message: "provider exploded" }));

    const err = await caller()
      .messages.send({ instanceId: INSTANCE_ID, to: "5511988887777", kind: "text", text: "Oi" })
      .catch((e: unknown) => e);

    expect((err as TRPCError).code).toBe("BAD_GATEWAY");
    expect(db.createMessageLog).toHaveBeenCalledWith(
      expect.objectContaining({ state: "failed" }),
    );
  });
});

// ── auth ────────────────────────────────────────────────────────────────────

describe("auth.signup", () => {
  it("maps an already-registered email to CONFLICT without leaking the query", async () => {
    vi.mocked(registerLocalUser).mockRejectedValueOnce(
      new EmailTakenError("Esse e-mail já está registrado."),
    );

    const err = await caller(null)
      .auth.signup({ email: "a@b.com", password: "hunter2hunter2" })
      .catch((e: unknown) => e);

    expect((err as TRPCError).code).toBe("CONFLICT");
    expect((err as TRPCError).message).not.toMatch(/insert into|Failed query|\$2b\$/);
  });
});

// ── upload key sanitization ─────────────────────────────────────────────────

// The key is `${uuid}-${sanitizeBasename(name)}`. The uuid prefix only makes the
// key unguessable if the REST of it isn't caller-controlled, so this function is
// what stops a `name` like "/../report.pdf" from steering path segments into
// someone else's key.
describe("sanitizeBasename", () => {
  it("passes a normal filename through unchanged", () => {
    expect(sanitizeBasename("report.pdf")).toBe("report.pdf");
  });

  it("takes only the last path segment, dropping any directory traversal", () => {
    expect(sanitizeBasename("/../report.pdf")).toBe("report.pdf");
    expect(sanitizeBasename("a/b/../evil.png")).toBe("evil.png");
    expect(sanitizeBasename("../../etc/passwd")).toBe("passwd");
  });

  it("strips characters outside [A-Za-z0-9._-]", () => {
    expect(sanitizeBasename("my file (final)!.png")).toBe("myfilefinal.png");
  });

  it("collapses leading dots so a bare '.' or '..' basename can't survive", () => {
    expect(sanitizeBasename("..")).toBe("upload");
    expect(sanitizeBasename(".")).toBe("upload");
    expect(sanitizeBasename("...hidden")).toBe("upload.hidden");
  });

  // Regression (observed 2026-08, published app gallery-app-gpkd51ak): a file
  // named 风景.png landed in storage as "<uuid>-png" — no dot, no extension. The
  // ASCII allowlist deleted the whole stem, leaving ".png", and the leading-dot
  // strip then ate the only dot left. Stem and extension are sanitized
  // SEPARATELY so this cannot happen.
  it("keeps the extension when the stem is entirely non-ASCII", () => {
    expect(sanitizeBasename("风景.png")).toBe("upload.png");
    expect(sanitizeBasename("日本語.jpeg")).toBe("upload.jpeg");
    expect(sanitizeBasename("相册/风景.png")).toBe("upload.png");
  });

  it("keeps the extension on names that already sanitized cleanly", () => {
    expect(sanitizeBasename("微信图片_2026.png")).toBe("_2026.png");
    expect(sanitizeBasename("IMG_1234.PNG")).toBe("IMG_1234.PNG");
    expect(sanitizeBasename("archive.tar.gz")).toBe("archive.tar.gz");
  });

  // A dotfile has no extension to preserve — the whole name is the stem.
  it("treats a leading-dot name as a stem, not as a bare extension", () => {
    expect(sanitizeBasename(".png")).toBe("png");
    expect(sanitizeBasename(".gitignore")).toBe("gitignore");
  });

  it("never emits a path separator, and caps the extension", () => {
    expect(sanitizeBasename("C:\\photos\\风景.png")).toBe("upload.png");
    expect(sanitizeBasename("x." + "a".repeat(40))).toBe("x." + "a".repeat(10));
  });

  it("falls back to a constant when nothing survives sanitization", () => {
    expect(sanitizeBasename("???")).toBe("upload");
    expect(sanitizeBasename("")).toBe("upload");
    expect(sanitizeBasename("///")).toBe("upload");
  });
});
