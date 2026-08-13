/// <reference lib="deno.ns" />

import {
  assert,
  assertEquals,
  assertMatch,
  assertNotMatch,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATION_URL = new URL(
  "../../../migrations/20260725035711_add_private_messenger_attachments_v2.sql",
  import.meta.url,
);
const source = await Deno.readTextFile(MIGRATION_URL);
const sql = source.toLowerCase();
const compact = sql.replace(/\s+/g, " ");

function functionBody(name: string): string {
  const startNeedle = `create or replace function public.${name}`;
  const start = sql.indexOf(startNeedle);
  assert(start >= 0, `${name} must exist`);
  const end = sql.indexOf(`\nrevoke all on function public.${name}`, start);
  assert(end > start, `${name} must be followed by an explicit revoke`);
  return sql.slice(start, end);
}

function createTableBody(name: string): string {
  const startNeedle = `create table if not exists public.${name}`;
  const start = sql.indexOf(startNeedle);
  assert(start >= 0, `${name} must exist`);
  const end = sql.indexOf("\n);", start);
  assert(end > start, `${name} table definition must close`);
  return sql.slice(start, end + 3);
}

Deno.test("migration creates one private 20 MiB bucket with the exact safe MIME allowlist", () => {
  const bucketStart = sql.indexOf("insert into storage.buckets");
  const bucketEnd = sql.indexOf(
    'drop policy if exists "messenger attachments v2 service read"',
    bucketStart,
  );
  assert(bucketStart >= 0 && bucketEnd > bucketStart);
  const bucket = sql.slice(bucketStart, bucketEnd);
  assertStringIncludes(bucket, "'messenger-attachments-v2'");
  assertMatch(
    bucket,
    /values\s*\(\s*'messenger-attachments-v2',\s*'messenger-attachments-v2',\s*false,/s,
  );
  assertStringIncludes(bucket, "20971520");
  assertMatch(bucket, /on conflict\s*\(id\)\s*do update\s*set public = false/s);

  const mimeArrayMatch = bucket.match(/array\s*\[([\s\S]*?)\]\s*::text\[\]/);
  assert(mimeArrayMatch, "bucket MIME array must exist");
  const mimeTypes = Array.from(mimeArrayMatch[1]!.matchAll(/'([^']+)'/g))
    .map((match) => match[1]);
  assertEquals(mimeTypes, [
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
    "image/bmp",
    "image/heic",
    "image/heif",
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "text/plain",
  ]);
  assertNotMatch(
    bucket,
    /application\/zip|application\/x-hwp|application\/octet-stream/,
  );
});

Deno.test("attachment metadata and storage policies are service-role-only with RLS enabled", () => {
  const tables = [
    "messenger_attachment_delivery_batches",
    "messenger_attachment_upload_intents",
    "messenger_attachment_objects",
    "messenger_message_attachments",
    "messenger_attachment_cleanup_outbox",
    "messenger_attachment_deletion_audit",
  ];
  for (const table of tables) {
    assertStringIncludes(
      compact,
      `alter table public.${table} enable row level security;`,
    );
    assertStringIncludes(
      compact,
      `revoke all privileges on table public.${table} from public, anon, authenticated, service_role;`,
    );
    assertMatch(
      compact,
      new RegExp(
        `grant select, insert, update, delete on table public\\.${table} to service_role;`,
      ),
    );
  }

  const storagePolicyStart = sql.indexOf(
    'drop policy if exists "messenger attachments v2 service read"',
  );
  const storagePolicyEnd = sql.indexOf(
    "create or replace function public.reserve_messenger_attachment_upload_batch_v2",
    storagePolicyStart,
  );
  assert(storagePolicyStart >= 0 && storagePolicyEnd > storagePolicyStart);
  const policies = sql.slice(storagePolicyStart, storagePolicyEnd);
  for (const operation of ["select", "insert", "update", "delete"]) {
    assertMatch(
      policies,
      new RegExp(
        `on storage\\.objects for ${operation} to service_role[\\s\\S]*?bucket_id = 'messenger-attachments-v2'`,
      ),
    );
  }
  assertNotMatch(policies, /\bto\s+(?:anon|authenticated|public)\b/);
  assertNotMatch(sql, /\bsecurity\s+definer\b/);
});

Deno.test("intent reservation is actor-serialized, idempotent and bounded by exact quotas", () => {
  const reserve = functionBody("reserve_messenger_attachment_upload_batch_v2");
  assertStringIncludes(reserve, "perform pg_advisory_xact_lock(");
  assertStringIncludes(
    reserve,
    "hashtextextended(p_actor_role || ':' || p_actor_id::text, 0)",
  );
  assertMatch(
    reserve,
    /v_expires_at timestamptz := v_now \+ interval '2 hours'/,
  );
  assertStringIncludes(reserve, "v_file_count not between 1 and 10");
  assertStringIncludes(reserve, "v_size not between 1 and 20971520");
  assertStringIncludes(reserve, "invalid_attachment_duplicate_file");
  assertStringIncludes(reserve, "attachment_idempotency_conflict");
  assertStringIncludes(
    reserve,
    "v_existing_files <> v_canonical_files",
  );
  assertMatch(
    reserve,
    /v_active_files \+ v_file_count > 50\s+or v_active_bytes \+ v_file_bytes > 209715200/s,
  );
  assertStringIncludes(reserve, "attachment_active_quota_exceeded");
  assertStringIncludes(
    reserve,
    "intent.created_at >= v_now - interval '1 hour'",
  );
  assertMatch(
    reserve,
    /v_recent_files \+ v_file_count > 100\s+or v_recent_batches \+ 1 > 20/s,
  );
  assertStringIncludes(reserve, "attachment_intent_rate_limited");
  assert(
    reserve.indexOf("pg_advisory_xact_lock") <
      reserve.indexOf("v_active_files + v_file_count > 50"),
    "actor lock must be acquired before quota accounting",
  );
  assertStringIncludes(reserve, "'messenger-direct-context:'");
  assert(
    reserve.indexOf("hashtextextended(p_actor_role || ':' || p_actor_id::text") <
      reserve.indexOf("'messenger-direct-context:'"),
    "actor lock must precede direct conversation locks",
  );

  const batches = createTableBody("messenger_attachment_delivery_batches");
  const intents = createTableBody("messenger_attachment_upload_intents");
  assertStringIncludes(batches, "unique (actor_id, actor_role, delivery_key)");
  assertStringIncludes(
    intents,
    "unique (batch_id, generation, client_file_id)",
  );
  assertStringIncludes(intents, "unique (batch_id, generation, sort_order)");
  assertStringIncludes(intents, "sort_order between 0 and 9");
  assertStringIncludes(intents, "inspected_size is not null");
  assertStringIncludes(intents, "inspected_sha256 is not null");
  assertMatch(
    reserve,
    /v_batch\.status in \('revoked', 'deleted'\)[\s\S]*?attachment_idempotency_conflict/,
  );
});

Deno.test("message actor and idempotency contracts reject nullable or spoofed values", () => {
  assertStringIncludes(
    compact,
    "alter table public.messages enable row level security;",
  );
  assertStringIncludes(
    compact,
    "revoke all privileges on table public.messages from public, anon, authenticated, service_role;",
  );
  assertStringIncludes(
    compact,
    "grant select, insert, update, delete on table public.messages to service_role;",
  );

  for (
    const name of [
      "reserve_messenger_attachment_upload_batch_v2",
      "validate_messenger_attachment_intents_v2",
      "commit_garamin_direct_message_with_attachments_v2",
      "commit_group_chat_message_with_attachments_v2",
      "commit_garamin_direct_broadcast_with_attachments_v2",
    ]
  ) {
    const body = functionBody(name);
    assertStringIncludes(body, "p_payload_fingerprint is null");
    assertStringIncludes(
      body,
      "payload_fingerprint is distinct from p_payload_fingerprint",
    );
  }

  const direct = functionBody(
    "commit_garamin_direct_message_with_attachments_v2",
  );
  assertStringIncludes(
    direct,
    "p_receiver_actor_id is distinct from v_fc_id",
  );
  const group = functionBody(
    "commit_group_chat_message_with_attachments_v2",
  );
  assertStringIncludes(
    group,
    "p_sender_role || ':' || regexp_replace(v_actor_phone, '[^0-9]', '', 'g')",
  );
  assertStringIncludes(direct, "'messenger-direct-context:'");
  assert(
    direct.indexOf("'messenger-direct-context:'") <
      direct.indexOf(
        "from public.messenger_attachment_delivery_batches batch",
      ),
    "direct conversation lock must precede the batch row lock",
  );
  assertMatch(
    direct,
    /coalesce\(p_content, ''\),\s+'file',\s+false,\s+v_batch\.id/s,
  );
  assertMatch(
    group,
    /coalesce\(p_content, ''\),\s+'file',\s+null,\s+null,\s+null,/s,
  );
  const broadcast = functionBody(
    "commit_garamin_direct_broadcast_with_attachments_v2",
  );
  assertStringIncludes(broadcast, "'messenger-direct-context:'");
  assert(
    broadcast.indexOf("'messenger-direct-context:'") <
      broadcast.indexOf(
        "from public.messenger_attachment_delivery_batches batch",
      ),
    "broadcast conversation locks must precede the batch row lock",
  );
  assertMatch(
    broadcast,
    /coalesce\(p_content, ''\),\s+'file',\s+false,\s+v_batch\.id/s,
  );
});

Deno.test("manager direct attachments keep the canonical manager actor role end to end", () => {
  const reserve = functionBody("reserve_messenger_attachment_upload_batch_v2");
  assertStringIncludes(reserve, "p_actor_role in ('admin', 'manager')");
  const direct = functionBody(
    "commit_garamin_direct_message_with_attachments_v2",
  );
  assertStringIncludes(direct, "from public.manager_accounts account");
  assertStringIncludes(direct, "v_actor_role := 'manager'");
  assertStringIncludes(
    direct,
    "p_sender_id is distinct from regexp_replace(v_staff_phone, '[^0-9]', '', 'g')",
  );
  assertStringIncludes(
    direct,
    "batch.actor_role = v_actor_role",
  );
  const deletion = functionBody("delete_messenger_attachment_delivery_v2");
  assertStringIncludes(
    deletion,
    "batch.actor_role = p_actor_role",
  );
});

Deno.test("cleanup uses a durable two-phase outbox with claim locking, retry and exhaustion", () => {
  const outbox = createTableBody("messenger_attachment_cleanup_outbox");
  assertStringIncludes(
    outbox,
    "sweep_phase text not null check (sweep_phase in ('immediate', 'post_token_expiry'))",
  );
  assertStringIncludes(outbox, "attempt_count integer not null default 0");
  assertStringIncludes(outbox, "max_attempts integer not null default 12");
  assertStringIncludes(
    outbox,
    "check (status in ('pending', 'processing', 'completed', 'exhausted'))",
  );
  assertStringIncludes(
    compact,
    "on public.messenger_attachment_cleanup_outbox (bucket_id, storage_path, sweep_phase)",
  );

  for (
    const name of [
      "reserve_messenger_attachment_upload_batch_v2",
      "revoke_messenger_attachment_upload_batch_v2",
      "delete_messenger_attachment_delivery_v2",
      "expire_messenger_attachment_intents_v2",
    ]
  ) {
    const body = functionBody(name);
    assertStringIncludes(
      body,
      "values ('immediate'::text), ('post_token_expiry'::text)",
    );
    assertStringIncludes(body, "+ interval '5 minutes'");
  }

  const claim = functionBody("claim_messenger_attachment_cleanup_v2");
  assertStringIncludes(claim, "for update skip locked");
  assertMatch(
    claim,
    /outbox\.status = 'processing'\s+and outbox\.locked_at < clock_timestamp\(\) - interval '5 minutes'/s,
  );
  assertStringIncludes(claim, "outbox.not_before <= clock_timestamp()");
  assertStringIncludes(claim, "attempt_count = outbox.attempt_count + 1");
  assertStringIncludes(claim, "least(coalesce(p_limit, 25), 100)");

  const complete = functionBody("complete_messenger_attachment_cleanup_v2");
  assertStringIncludes(
    complete,
    "when v_job.attempt_count >= v_job.max_attempts then 'exhausted'",
  );
  assertStringIncludes(
    complete,
    "secs => least(3600, (power(2, least(attempt_count, 11))::integer * 5))",
  );
  assertMatch(
    complete,
    /set status = 'completed',\s+bucket_id = null,\s+storage_path = null/s,
  );
  assertStringIncludes(
    complete,
    "pending.status <> 'completed'",
  );

  const requeue = functionBody(
    "requeue_exhausted_messenger_attachment_cleanup_v2",
  );
  assertStringIncludes(requeue, "where outbox.status = 'exhausted'");
  assertStringIncludes(requeue, "for update skip locked");
  assertMatch(
    requeue,
    /set status = 'pending',\s+attempt_count = 0,\s+not_before = clock_timestamp\(\)/s,
  );
});

Deno.test("message deletion is soft, scrubs paths and retains only audit metadata", () => {
  const deletion = functionBody("delete_messenger_attachment_delivery_v2");
  assertMatch(
    deletion,
    /update public\.messages\s+set deleted_at = coalesce\(deleted_at, v_now\),\s+deleted_by_actor_id = coalesce\(deleted_by_actor_id, p_actor_id\),\s+content = ''/s,
  );
  assertMatch(
    deletion,
    /update public\.group_chat_messages\s+set deleted_at = coalesce\(deleted_at, v_now\),\s+deleted_by_actor_id = coalesce\(deleted_by_actor_id, p_group_actor_id\),\s+content = ''/s,
  );
  assertNotMatch(
    deletion,
    /delete from public\.(?:messages|group_chat_messages)\b/,
  );
  assertMatch(
    deletion,
    /set conversation_ids = array_remove\(conversation_ids, v_deleted_conversation_id\),\s+updated_at = v_now\s+where id = v_batch_id\s+and context_kind = 'direct_broadcast'/s,
  );
  assertStringIncludes(
    deletion,
    "insert into public.messenger_attachment_deletion_audit",
  );
  assertMatch(
    deletion,
    /update public\.messenger_attachment_objects\s+set bucket_id = null,\s+storage_path = null,\s+reference_count = 0,\s+status = 'tombstoned'/s,
  );

  const audit = createTableBody("messenger_attachment_deletion_audit");
  for (const metadata of ["original_name", "byte_size", "sha256"]) {
    assertStringIncludes(audit, metadata);
  }
  assertNotMatch(
    audit,
    /\bbucket_id\b|\bstorage_path\b|\bfile_bytes\b|\bcontent\b/,
  );
  assertNotMatch(sql, /delete\s+from\s+storage\.objects\b/);
});

Deno.test("broadcast replay binds every message id to its requested conversation", () => {
  const broadcast = functionBody(
    "commit_garamin_direct_broadcast_with_attachments_v2",
  );
  const exactPairJoin =
    /from unnest\(p_message_ids, p_conversation_ids\)\s+as requested\(message_id, conversation_id\)\s+join public\.messages message\s+on message\.id = requested\.message_id\s+and message\.conversation_id = requested\.conversation_id/g;
  assertEquals(broadcast.match(exactPairJoin)?.length, 2);
});

Deno.test("account deletion atomically tombstones attachment paths before actor removal", () => {
  const cleanup = functionBody("queue_messenger_attachment_actor_cleanup_v2");
  assertStringIncludes(cleanup, "returns trigger");
  assertStringIncludes(cleanup, "reason_code");
  assertStringIncludes(cleanup, "'account_deleted'");
  assertStringIncludes(
    cleanup,
    "values ('immediate'::text), ('post_token_expiry'::text)",
  );
  assertStringIncludes(cleanup, "storage_path = null");
  assertStringIncludes(cleanup, "status = 'tombstoned'");
  assertStringIncludes(cleanup, "perform pg_advisory_xact_lock(");
  assertStringIncludes(
    compact,
    "conversation_id uuid references public.garamin_direct_conversations(id) on delete set null",
  );
  assertStringIncludes(
    compact,
    "or status in ('pending', 'expired', 'revoked', 'deleted')",
  );
  assertMatch(
    cleanup,
    /batch\.context_kind = 'direct'\s+and batch\.conversation_id = any\(v_target_conversation_ids\)/,
  );
  assertStringIncludes(
    cleanup,
    "batch.context_kind = 'direct_broadcast'",
  );
  assertStringIncludes(cleanup, "batch.conversation_ids && v_target_conversation_ids");
  assertStringIncludes(cleanup, "'messenger-direct-context:'");
  assertMatch(
    cleanup,
    /set conversation_ids = v_reconciled_conversation_ids,\s+updated_at = v_now/s,
  );
  assertStringIncludes(cleanup, "set reference_count = v_remaining");
  assertMatch(
    cleanup,
    /batch\.status = 'committed'\s+and not exists \(\s+select 1\s+from public\.messages message/s,
  );
  for (
    const table of ["fc_profiles", "manager_accounts", "admin_accounts"]
  ) {
    assertMatch(
      compact,
      new RegExp(
        `before delete on public\\.${table} for each row execute function public\\.queue_messenger_attachment_actor_cleanup_v2\\(\\)`,
      ),
    );
  }
});

Deno.test("every privileged attachment RPC is explicitly revoked from clients and granted to service_role", () => {
  const functions = [
    "reserve_messenger_attachment_upload_batch_v2",
    "validate_messenger_attachment_intents_v2",
    "revoke_messenger_attachment_upload_batch_v2",
    "materialize_messenger_attachment_batch_v2",
    "commit_garamin_direct_message_with_attachments_v2",
    "commit_group_chat_message_with_attachments_v2",
    "commit_garamin_direct_broadcast_with_attachments_v2",
    "delete_messenger_attachment_delivery_v2",
    "expire_messenger_attachment_intents_v2",
    "claim_messenger_attachment_cleanup_v2",
    "complete_messenger_attachment_cleanup_v2",
    "requeue_exhausted_messenger_attachment_cleanup_v2",
  ];
  for (const name of functions) {
    const bodyEnd = sql.indexOf(`\nrevoke all on function public.${name}`);
    assert(bodyEnd >= 0, `${name} must revoke default PUBLIC execute`);
    const revokeEnd = sql.indexOf(";", bodyEnd);
    const revoke = sql.slice(bodyEnd, revokeEnd + 1);
    assertMatch(revoke, /from public,\s*anon,\s*authenticated/s);
    const grantEnd = sql.indexOf(";", revokeEnd + 1);
    const grant = sql.slice(revokeEnd + 1, grantEnd + 1);
    assertStringIncludes(grant, `grant execute on function public.${name}`);
    assertStringIncludes(grant, "to service_role");
  }
});
