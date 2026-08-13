/// <reference lib="deno.ns" />

import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  createMessengerAttachmentDownload,
  drainMessengerAttachmentCleanup,
  finalizeMessengerAttachmentBatch,
  listMessengerAttachmentsByBatchIds,
  mapMessengerAttachmentRpcError,
  MessengerAttachmentServiceError,
} from "../messenger-attachment-service.ts";
import {
  MESSENGER_ATTACHMENT_BUCKET,
  MESSENGER_ATTACHMENT_DOWNLOAD_TTL_SECONDS,
} from "../messenger-attachment-policy.ts";

type Row = Record<string, unknown>;
type QueryResult = { data: unknown; error: Row | null };
type RpcHandler = (args: Row) => QueryResult | Promise<QueryResult>;

const ACTOR_ID = "00000000-0000-4000-8000-000000000101";
const BATCH_ID = "00000000-0000-4000-8000-000000000201";
const DELIVERY_KEY = "00000000-0000-4000-8000-000000000301";
const INTENT_ID = "00000000-0000-4000-8000-000000000401";
const ATTACHMENT_ID = "00000000-0000-4000-8000-000000000501";
const JOB_IDS = [
  "00000000-0000-4000-8000-000000000601",
  "00000000-0000-4000-8000-000000000602",
  "00000000-0000-4000-8000-000000000603",
];
const FINGERPRINT = "b".repeat(64);

function matches(
  row: Row,
  filters: Array<{
    kind: "eq" | "in";
    column: string;
    value: unknown;
  }>,
): boolean {
  return filters.every((filter) => {
    if (filter.kind === "eq") return row[filter.column] === filter.value;
    return Array.isArray(filter.value) &&
      filter.value.includes(row[filter.column]);
  });
}

class FakeQuery implements PromiseLike<QueryResult> {
  private readonly filters: Array<{
    kind: "eq" | "in";
    column: string;
    value: unknown;
  }> = [];

  constructor(
    private readonly owner: FakeSupabase,
    private readonly table: string,
  ) {}

  select(_columns: string) {
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push({ kind: "eq", column, value });
    return this;
  }

  in(column: string, value: unknown[]) {
    this.filters.push({ kind: "in", column, value });
    return this;
  }

  private result(): QueryResult {
    if (this.owner.tableErrors[this.table]) {
      return { data: null, error: this.owner.tableErrors[this.table]! };
    }
    return {
      data: (this.owner.rows[this.table] ?? []).filter((row) =>
        matches(row, this.filters)
      ),
      error: null,
    };
  }

  async maybeSingle(): Promise<QueryResult> {
    const result = this.result();
    const rows = Array.isArray(result.data) ? result.data : [];
    return { ...result, data: rows[0] ?? null };
  }

  async order(
    column: string,
    options?: { ascending?: boolean },
  ): Promise<QueryResult> {
    const result = this.result();
    const direction = options?.ascending === false ? -1 : 1;
    const rows = Array.isArray(result.data) ? [...result.data] as Row[] : [];
    rows.sort((left, right) =>
      direction * (Number(left[column] ?? 0) - Number(right[column] ?? 0))
    );
    return { ...result, data: rows };
  }

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?:
      | ((value: QueryResult) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.result()).then(onfulfilled, onrejected);
  }
}

class FakeSupabase {
  readonly rows: Record<string, Row[]> = {};
  readonly tableErrors: Record<string, Row | undefined> = {};
  readonly rpcHandlers: Record<string, RpcHandler> = {};
  readonly rpcCalls: Array<{ name: string; args: Row }> = [];
  readonly storageDownloads: Array<{ bucket: string; path: string }> = [];
  readonly signedUrlCalls: Array<{
    bucket: string;
    path: string;
    ttl: number;
    options: Row;
  }> = [];
  readonly removalCalls: Array<{ bucket: string; paths: string[] }> = [];
  readonly blobs: Record<string, Blob> = {};
  readonly removalErrors: Record<string, Row | null> = {};

  from(table: string) {
    return new FakeQuery(this, table);
  }

  async rpc(name: string, args: Row): Promise<QueryResult> {
    this.rpcCalls.push({ name, args });
    return await (this.rpcHandlers[name]?.(args) ??
      { data: null, error: { message: `unhandled rpc: ${name}` } });
  }

  readonly storage = {
    from: (bucket: string) => ({
      download: async (path: string): Promise<QueryResult> => {
        this.storageDownloads.push({ bucket, path });
        const blob = this.blobs[`${bucket}/${path}`];
        return blob
          ? { data: blob, error: null }
          : { data: null, error: { status: 404, message: "not found" } };
      },
      createSignedUrl: async (
        path: string,
        ttl: number,
        options: Row,
      ): Promise<QueryResult> => {
        this.signedUrlCalls.push({ bucket, path, ttl, options });
        return {
          data: { signedUrl: `https://signed.invalid/${bucket}/${path}` },
          error: null,
        };
      },
      remove: async (paths: string[]): Promise<QueryResult> => {
        this.removalCalls.push({ bucket, paths });
        const error = this.removalErrors[`${bucket}/${paths[0]}`] ?? null;
        return { data: error ? null : [], error };
      },
    }),
  };
}

function asClient(fake: FakeSupabase): never {
  return fake as never;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    bytes.slice().buffer as ArrayBuffer,
  );
  return Array.from(new Uint8Array(hash))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function pendingBatch(overrides: Row = {}): Row {
  return {
    id: BATCH_ID,
    actor_id: ACTOR_ID,
    actor_role: "fc",
    delivery_key: DELIVERY_KEY,
    generation: 1,
    status: "pending",
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    payload_fingerprint: FINGERPRINT,
    committed_message_ids: null,
    ...overrides,
  };
}

Deno.test("finalization rejects malformed actor-bound intent references before querying", async () => {
  const fake = new FakeSupabase();
  const error = await assertRejects(
    () =>
      finalizeMessengerAttachmentBatch({
        supabase: asClient(fake),
        actor: { id: ACTOR_ID, role: "fc" },
        deliveryKey: "not-a-uuid",
        payloadFingerprint: FINGERPRINT,
        intentIds: [INTENT_ID],
      }),
    MessengerAttachmentServiceError,
    "invalid_attachment_intent_reference",
  );
  assertEquals(error.status, 400);
  assertEquals(Object.keys(fake.rows), []);
});

Deno.test("committed idempotent replay returns message ids without storage or validation calls", async () => {
  const fake = new FakeSupabase();
  fake.rows.messenger_attachment_delivery_batches = [pendingBatch({
    status: "committed",
    expires_at: new Date(Date.now() - 60_000).toISOString(),
    committed_message_ids: [ATTACHMENT_ID],
  })];

  const result = await finalizeMessengerAttachmentBatch({
    supabase: asClient(fake),
    actor: { id: ACTOR_ID, role: "fc" },
    deliveryKey: DELIVERY_KEY,
    payloadFingerprint: FINGERPRINT,
    intentIds: [INTENT_ID],
  });
  assertEquals(result, {
    batchId: BATCH_ID,
    replayed: true,
    committedMessageIds: [ATTACHMENT_ID],
    inspections: [],
  });
  assertEquals(fake.storageDownloads, []);
  assertEquals(fake.rpcCalls, []);
});

Deno.test("finalization downloads every object, verifies bytes, then validates exact inspections", async () => {
  const fake = new FakeSupabase();
  const bytes = new TextEncoder().encode("안전한 TXT 첨부");
  const sha256 = await sha256Hex(bytes);
  const objectPath = `${ACTOR_ID}/${DELIVERY_KEY}/1/${INTENT_ID}`;
  fake.rows.messenger_attachment_delivery_batches = [pendingBatch()];
  fake.rows.messenger_attachment_upload_intents = [{
    id: INTENT_ID,
    batch_id: BATCH_ID,
    generation: 1,
    client_file_id: "00000000-0000-4000-8000-000000000701",
    sort_order: 0,
    original_name: "메모.txt",
    declared_mime_type: "text/plain",
    expected_size: bytes.length,
    expected_sha256: sha256,
    bucket_id: MESSENGER_ATTACHMENT_BUCKET,
    object_path: objectPath,
    status: "pending",
    expires_at: new Date(Date.now() + 60_000).toISOString(),
  }];
  fake.blobs[`${MESSENGER_ATTACHMENT_BUCKET}/${objectPath}`] = new Blob(
    [bytes],
    {
      type: "text/plain",
    },
  );
  fake.rpcHandlers.validate_messenger_attachment_intents_v2 = (args) => ({
    data: { state: "validated", batchId: BATCH_ID },
    error: null,
  });

  const result = await finalizeMessengerAttachmentBatch({
    supabase: asClient(fake),
    actor: { id: ACTOR_ID, role: "fc" },
    deliveryKey: DELIVERY_KEY,
    payloadFingerprint: FINGERPRINT,
    intentIds: [INTENT_ID],
  });

  assertEquals(result.replayed, false);
  assertEquals(result.inspections, [{
    id: INTENT_ID,
    extension: ".txt",
    mimeType: "text/plain",
    family: "txt",
    sha256,
    size: bytes.length,
  }]);
  assertEquals(fake.storageDownloads, [{
    bucket: MESSENGER_ATTACHMENT_BUCKET,
    path: objectPath,
  }]);
  assertEquals(
    fake.rpcCalls[0]?.name,
    "validate_messenger_attachment_intents_v2",
  );
  assertEquals(fake.rpcCalls[0]?.args, {
    p_actor_id: ACTOR_ID,
    p_actor_role: "fc",
    p_delivery_key: DELIVERY_KEY,
    p_payload_fingerprint: FINGERPRINT,
    p_intents: [{
      id: INTENT_ID,
      family: "txt",
      mimeType: "text/plain",
      size: bytes.length,
      sha256,
    }],
  });
});

Deno.test("finalization fails closed for idempotency, expiry, missing bytes and storage MIME mismatch", async () => {
  const conflict = new FakeSupabase();
  conflict.rows.messenger_attachment_delivery_batches = [pendingBatch({
    payload_fingerprint: "c".repeat(64),
  })];
  const idempotencyError = await assertRejects(
    () =>
      finalizeMessengerAttachmentBatch({
        supabase: asClient(conflict),
        actor: { id: ACTOR_ID, role: "fc" },
        deliveryKey: DELIVERY_KEY,
        payloadFingerprint: FINGERPRINT,
        intentIds: [INTENT_ID],
      }),
    MessengerAttachmentServiceError,
    "idempotency_conflict",
  );
  assertEquals(idempotencyError.status, 409);

  const expired = new FakeSupabase();
  expired.rows.messenger_attachment_delivery_batches = [pendingBatch({
    expires_at: new Date(Date.now() - 1_000).toISOString(),
  })];
  const expiredError = await assertRejects(
    () =>
      finalizeMessengerAttachmentBatch({
        supabase: asClient(expired),
        actor: { id: ACTOR_ID, role: "fc" },
        deliveryKey: DELIVERY_KEY,
        payloadFingerprint: FINGERPRINT,
        intentIds: [INTENT_ID],
      }),
    MessengerAttachmentServiceError,
    "attachment_intent_expired",
  );
  assertEquals(expiredError.status, 410);

  const missing = new FakeSupabase();
  missing.rows.messenger_attachment_delivery_batches = [pendingBatch()];
  missing.rows.messenger_attachment_upload_intents = [{
    id: INTENT_ID,
    batch_id: BATCH_ID,
    generation: 1,
    sort_order: 0,
    object_path: "missing",
    status: "pending",
    expires_at: new Date(Date.now() + 60_000).toISOString(),
  }];
  const missingError = await assertRejects(
    () =>
      finalizeMessengerAttachmentBatch({
        supabase: asClient(missing),
        actor: { id: ACTOR_ID, role: "fc" },
        deliveryKey: DELIVERY_KEY,
        payloadFingerprint: FINGERPRINT,
        intentIds: [INTENT_ID],
      }),
    MessengerAttachmentServiceError,
    "attachment_object_missing",
  );
  assertEquals(missingError.status, 409);

  const mimeMismatch = new FakeSupabase();
  const bytes = new TextEncoder().encode("plain");
  const sha256 = await sha256Hex(bytes);
  mimeMismatch.rows.messenger_attachment_delivery_batches = [pendingBatch()];
  mimeMismatch.rows.messenger_attachment_upload_intents = [{
    id: INTENT_ID,
    batch_id: BATCH_ID,
    generation: 1,
    sort_order: 0,
    original_name: "plain.txt",
    declared_mime_type: "text/plain",
    expected_size: bytes.length,
    expected_sha256: sha256,
    bucket_id: MESSENGER_ATTACHMENT_BUCKET,
    object_path: "wrong-mime",
    status: "pending",
    expires_at: new Date(Date.now() + 60_000).toISOString(),
  }];
  mimeMismatch.blobs[`${MESSENGER_ATTACHMENT_BUCKET}/wrong-mime`] = new Blob([
    bytes,
  ], {
    type: "application/pdf",
  });
  const mimeError = await assertRejects(
    () =>
      finalizeMessengerAttachmentBatch({
        supabase: asClient(mimeMismatch),
        actor: { id: ACTOR_ID, role: "fc" },
        deliveryKey: DELIVERY_KEY,
        payloadFingerprint: FINGERPRINT,
        intentIds: [INTENT_ID],
      }),
    MessengerAttachmentServiceError,
    "invalid_attachment_mime",
  );
  assertEquals(mimeError.status, 400);
});

Deno.test("attachment listing is batch-bound, stable-order and excludes tombstoned objects", async () => {
  const fake = new FakeSupabase();
  const secondBatch = "00000000-0000-4000-8000-000000000202";
  fake.rows.messenger_attachment_objects = [
    {
      id: ATTACHMENT_ID,
      batch_id: BATCH_ID,
      sort_order: 1,
      original_name: "두번째.pdf",
      mime_type: "application/pdf",
      byte_size: 20,
      sha256: "2".repeat(64),
      status: "active",
    },
    {
      id: "00000000-0000-4000-8000-000000000502",
      batch_id: BATCH_ID,
      sort_order: 0,
      original_name: "첫번째.txt",
      mime_type: "text/plain",
      byte_size: 10,
      sha256: "1".repeat(64),
      status: "active",
    },
    {
      id: "00000000-0000-4000-8000-000000000503",
      batch_id: BATCH_ID,
      sort_order: 2,
      original_name: "삭제됨.txt",
      mime_type: "text/plain",
      byte_size: 1,
      sha256: "3".repeat(64),
      status: "tombstoned",
    },
    {
      id: "00000000-0000-4000-8000-000000000504",
      batch_id: secondBatch,
      sort_order: 0,
      original_name: "다른배치.txt",
      mime_type: "text/plain",
      byte_size: 1,
      sha256: "4".repeat(64),
      status: "active",
    },
  ];

  const result = await listMessengerAttachmentsByBatchIds({
    supabase: asClient(fake),
    batchIds: [BATCH_ID, BATCH_ID, null, "invalid"],
  });
  assertEquals(result.get(BATCH_ID), [
    {
      id: "00000000-0000-4000-8000-000000000502",
      name: "첫번째.txt",
      size: 10,
      mimeType: "text/plain",
      sha256: "1".repeat(64),
    },
    {
      id: ATTACHMENT_ID,
      name: "두번째.pdf",
      size: 20,
      mimeType: "application/pdf",
      sha256: "2".repeat(64),
    },
  ]);
  assertEquals(result.has(secondBatch), false);
});

Deno.test("download signing is private, short-lived and uses the original filename", async () => {
  const fake = new FakeSupabase();
  fake.rows.messenger_attachment_objects = [{
    id: ATTACHMENT_ID,
    batch_id: BATCH_ID,
    original_name: "한글 보고서.pdf",
    mime_type: "application/pdf",
    byte_size: 123,
    sha256: "d".repeat(64),
    bucket_id: MESSENGER_ATTACHMENT_BUCKET,
    storage_path: "private/object",
    status: "active",
  }];

  const before = Date.now();
  const result = await createMessengerAttachmentDownload({
    supabase: asClient(fake),
    attachmentId: ATTACHMENT_ID,
  });
  const after = Date.now();
  assertEquals(result.batchId, BATCH_ID);
  assertEquals(result.attachment.name, "한글 보고서.pdf");
  assertEquals(fake.signedUrlCalls, [{
    bucket: MESSENGER_ATTACHMENT_BUCKET,
    path: "private/object",
    ttl: MESSENGER_ATTACHMENT_DOWNLOAD_TTL_SECONDS,
    options: { download: "한글 보고서.pdf" },
  }]);
  const expiresAt = Date.parse(result.expiresAt);
  assertEquals(
    expiresAt >= before + MESSENGER_ATTACHMENT_DOWNLOAD_TTL_SECONDS * 1000,
    true,
  );
  assertEquals(
    expiresAt <= after + MESSENGER_ATTACHMENT_DOWNLOAD_TTL_SECONDS * 1000,
    true,
  );
});

Deno.test("cleanup failure is operational-only, while claimed jobs are completed/requeued/exhausted", async () => {
  const unavailable = new FakeSupabase();
  unavailable.rpcHandlers.claim_messenger_attachment_cleanup_v2 = () => ({
    data: null,
    error: { message: "database unavailable" },
  });
  assertEquals(
    await drainMessengerAttachmentCleanup({
      supabase: asClient(unavailable),
    }),
    {
      claimed: 0,
      removed: 0,
      requeued: 0,
      exhausted: 0,
    },
  );
  assertEquals(unavailable.removalCalls, []);

  const fake = new FakeSupabase();
  fake.rpcHandlers.claim_messenger_attachment_cleanup_v2 = () => ({
    data: JOB_IDS.map((jobId, index) => ({
      job_id: jobId,
      bucket_id: MESSENGER_ATTACHMENT_BUCKET,
      storage_path: `cleanup/${index}`,
    })),
    error: null,
  });
  fake.removalErrors[`${MESSENGER_ATTACHMENT_BUCKET}/cleanup/1`] = {
    status: 503,
    message: "retry",
  };
  fake.removalErrors[`${MESSENGER_ATTACHMENT_BUCKET}/cleanup/2`] = {
    status: 503,
    message: "exhaust",
  };
  fake.rpcHandlers.complete_messenger_attachment_cleanup_v2 = (args) => ({
    data: {
      status: args.p_job_id === JOB_IDS[0]
        ? "completed"
        : args.p_job_id === JOB_IDS[2]
        ? "exhausted"
        : "pending",
    },
    error: null,
  });

  assertEquals(
    await drainMessengerAttachmentCleanup({
      supabase: asClient(fake),
      limit: 500,
      batchId: BATCH_ID,
    }),
    {
      claimed: 3,
      removed: 1,
      requeued: 1,
      exhausted: 1,
    },
  );
  assertEquals(fake.rpcCalls[0], {
    name: "claim_messenger_attachment_cleanup_v2",
    args: { p_limit: 100, p_batch_id: BATCH_ID },
  });
});

Deno.test("RPC error mapping uses intentional 400/403/404/409/410/429/503 semantics", () => {
  const vectors: Array<[string, string, number]> = [
    ["attachment_intent_rate_limited", "attachment_intent_rate_limited", 429],
    [
      "attachment_active_quota_exceeded",
      "attachment_active_quota_exceeded",
      429,
    ],
    ["attachment_idempotency_conflict", "idempotency_conflict", 409],
    ["attachment_intent_set_mismatch", "attachment_intent_conflict", 409],
    ["attachment_intent_consumed", "attachment_intent_consumed", 410],
    ["attachment_context_forbidden", "forbidden", 403],
    ["attachment_context_not_found", "context_not_found", 404],
    ["invalid_attachment_file_metadata", "invalid_attachment_request", 400],
    ["unexpected database error", "attachment_database_unavailable", 503],
  ];
  for (const [message, code, status] of vectors) {
    const mapped = mapMessengerAttachmentRpcError({ message });
    assertEquals(mapped.code, code);
    assertEquals(mapped.status, status);
  }
});
