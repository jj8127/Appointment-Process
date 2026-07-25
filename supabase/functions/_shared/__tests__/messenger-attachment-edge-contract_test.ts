/// <reference lib="deno.ns" />

import {
  assertMatch,
  assertNotMatch,
  assertStringIncludes,
} from 'https://deno.land/std@0.224.0/assert/mod.ts';

const decoder = new TextDecoder();
const root = new URL('../../', import.meta.url);

async function source(relativePath: string) {
  return decoder.decode(
    await Deno.readFile(new URL(relativePath, root)),
  );
}

Deno.test('direct chat and MatrixView broadcast commit private batches atomically', async () => {
  const text = await source('fc-notify/index.ts');

  assertStringIncludes(text, "'commit_garamin_direct_message_with_attachments_v2'");
  assertStringIncludes(text, "'commit_garamin_direct_broadcast_with_attachments_v2'");
  assertStringIncludes(text, 'finalizeMessengerAttachmentBatch({');
  assertStringIncludes(text, 'listMessengerAttachmentsByBatchIds({');
  assertStringIncludes(text, 'attachmentCommit:');
  assertStringIncludes(text, 'role: appActor.sessionRole');
  assertStringIncludes(text, 'p_actor_role: appActor.sessionRole');
  assertStringIncludes(text, "body.content || '첨부파일을 보냈습니다.'");
  assertStringIncludes(text, "pushStatus: 'not_attempted'");
  assertStringIncludes(text, 'retryable: false');
  assertNotMatch(
    text,
    /if\s*\([^)]*no_registered_device[^)]*\)\s*return\s+err/s,
  );
});

Deno.test('direct lists dual-read legacy metadata and private attachments without deleted rows', async () => {
  const text = await source('fc-notify/index.ts');

  assertStringIncludes(text, 'file_url: row.file_url');
  assertStringIncludes(text, 'file_name: row.file_name');
  assertStringIncludes(text, 'file_size: row.file_size');
  assertStringIncludes(text, 'attachments,');
  assertStringIncludes(text, 'row.deleted_at === null');
  assertStringIncludes(text, 'buildInternalChatSummaryRows');
  assertStringIncludes(text, '`첨부파일 ${batchAttachments.length}개`');
});

Deno.test('group chat V2 is private, replay-safe, hydrated on every message surface', async () => {
  const text = await source('group-chat/index.ts');

  assertStringIncludes(text, "'commit_group_chat_message_with_attachments_v2'");
  assertStringIncludes(text, "'legacy_attachment_upload_disabled'");
  assertStringIncludes(text, 'attachmentCommit?.replayed');
  assertStringIncludes(text, 'message: serializeMessage(message, 0, [], messageAttachments)');
  assertStringIncludes(text, 'attachmentMapForMessages(messages)');
  assertStringIncludes(text, 'attachmentMapForMessages([message])');
  assertStringIncludes(text, 'attachments: MessengerAttachmentMetadata[] = []');
  assertStringIncludes(text, "warning: null");
  assertNotMatch(text, /storage\/v1\/object\/public\/chat-uploads/);
});

Deno.test('message and account deletion schedule operational cleanup without user warning', async () => {
  const direct = await source('fc-notify/index.ts');
  const group = await source('group-chat/index.ts');
  const admin = await source('admin-action/index.ts');

  assertStringIncludes(direct, "'delete_messenger_attachment_delivery_v2'");
  assertStringIncludes(group, "'delete_messenger_attachment_delivery_v2'");
  assertStringIncludes(direct, 'drainMessengerAttachmentCleanup({');
  assertStringIncludes(group, 'drainMessengerAttachmentCleanup({');
  assertStringIncludes(admin, 'drainMessengerAttachmentCleanup({');
  assertMatch(
    admin,
    /Draining is best-effort and never becomes a\s*\n\s*\/\/ user-facing warning/,
  );
});
