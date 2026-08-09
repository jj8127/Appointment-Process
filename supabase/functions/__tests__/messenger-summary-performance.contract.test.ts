import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (relativePath: string) =>
  readFileSync(join(process.cwd(), relativePath), 'utf8');

describe('Internal Messenger V2 summary performance contract', () => {
  const edge = read('supabase/functions/fc-notify/index.ts');
  const migration = read(
    'supabase/migrations/20260808144212_internal_messenger_summary_v1.sql',
  );
  const schema = read('supabase/schema.sql');

  test('list handlers call the bounded summary RPC instead of loading message history', () => {
    const chatTargetsStart = edge.indexOf("if (body.type === 'chat_targets')");
    const internalListStart = edge.indexOf("if (body.type === 'internal_chat_list')", chatTargetsStart);
    const unreadStart = edge.indexOf("if (body.type === 'internal_unread_count')", internalListStart);
    const chatTargets = edge.slice(chatTargetsStart, internalListStart);
    const internalList = edge.slice(internalListStart, unreadStart);

    expect(chatTargets).toContain('fetchInternalMessengerSummaries(residentId, targetSenderIds)');
    expect(internalList).toContain("'list_internal_chat_page_v1'");
    expect(internalList).not.toContain('fetchInternalFcProfiles()');
    expect(internalList).not.toContain('fetchInternalMessengerSummaries(');
    expect(chatTargets).not.toContain(".from('messages')");
    expect(internalList).not.toContain(".from('messages')");
    expect(chatTargets).not.toContain('listMessengerAttachmentsByBatchIds');
    expect(internalList).not.toContain('listMessengerAttachmentsByBatchIds');
    expect(edge).not.toContain('buildInternalChatSummaryRows');
  });

  test('RPC receives only the verified viewer and server-derived target ids', () => {
    const helperStart = edge.indexOf('async function fetchInternalMessengerSummaries');
    const helperEnd = edge.indexOf('function isMissingInternalMessengerSummaryRpc', helperStart);
    const helper = edge.slice(helperStart, helperEnd);

    expect(helper).toContain("supabase.rpc('get_internal_messenger_summaries_v1'");
    expect(helper).toContain('p_viewer_id: viewerId');
    expect(helper).toContain('p_target_ids: uniqueTargetIds');
    expect(helper).not.toMatch(/supabase\.(from|insert|update|upsert)\(/);
  });

  test('uses the legacy summary query only as a missing-RPC rollout compatibility path', () => {
    const compatibilityStart = edge.indexOf('function isMissingInternalMessengerSummaryRpc');
    const compatibilityEnd = edge.indexOf('function buildNotificationReceiptViewer', compatibilityStart);
    const compatibility = edge.slice(compatibilityStart, compatibilityEnd);
    const chatTargetsStart = edge.indexOf("if (body.type === 'chat_targets')");
    const internalListStart = edge.indexOf("if (body.type === 'internal_chat_list')", chatTargetsStart);
    const unreadStart = edge.indexOf("if (body.type === 'internal_unread_count')", internalListStart);
    const chatTargets = edge.slice(chatTargetsStart, internalListStart);
    const internalList = edge.slice(internalListStart, unreadStart);

    expect(compatibility).toContain("code === 'PGRST202'");
    expect(compatibility).toContain("code === '42883'");
    expect(compatibility).toContain(".from('messages')");
    expect(compatibility).toContain(".is('deleted_at', null)");
    expect(chatTargets).toContain('if (!isMissingInternalMessengerSummaryRpc(summaryErr))');
    expect(chatTargets).toContain(
      'chatSummaries = await fetchLegacyInternalMessengerSummaries(residentId, targetSenderIds)',
    );
    expect(compatibility).toContain('function isMissingInternalChatPageRpc');
    expect(compatibility).toContain('async function fetchLegacyInternalChatList');
    expect(internalList).toContain('if (!isMissingInternalChatPageRpc(pageError))');
    expect(internalList).toContain('const legacy = await fetchLegacyInternalChatList(');
  });

  test.each([migration, schema])(
    'SQL contract is invoker-only, excludes deleted rows, and deterministically selects latest',
    (sql) => {
      expect(sql).toContain('public.get_internal_messenger_summaries_v1');
      expect(sql).toContain('security invoker');
      expect(sql).toContain("set search_path = ''");
      expect(sql).toContain('where outbound.sender_id = p_viewer_id');
      expect(sql).toContain('where inbound.sender_id = target.target_id');
      expect(sql).toContain('and outbound.deleted_at is null');
      expect(sql).toContain('and inbound.deleted_at is null');
      expect(sql).toContain('and unread_message.deleted_at is null');
      expect(sql).toContain('order by message.created_at desc, message.id desc');
      expect(sql).toContain("then '첨부파일'");
      expect(sql).toContain(
        'revoke all on function public.get_internal_messenger_summaries_v1(text, text[])',
      );
      expect(sql).toContain('from public, anon, authenticated');
      expect(sql).toContain(
        'grant execute on function public.get_internal_messenger_summaries_v1(text, text[])',
      );
      expect(sql).toContain('to service_role');
    },
  );

  test.each([migration, schema])('adds partial indexes for latest and unread lookups', (sql) => {
    expect(sql).toContain('idx_messages_live_sender_receiver_created');
    expect(sql).toContain('(sender_id, receiver_id, created_at desc, id desc)');
    expect(sql).toContain('where deleted_at is null');
    expect(sql).toContain('idx_messages_live_unread_receiver_sender');
    expect(sql).toContain('(receiver_id, sender_id, created_at desc, id desc)');
    expect(sql).toContain('where deleted_at is null and is_read = false');
  });

  test.each([migration, schema])(
    'pages internal FC summaries inside Postgres with exact ACL and keyset order',
    (sql) => {
      expect(sql).toContain('public.list_internal_chat_page_v1');
      expect(sql).toContain('p_include_all_completed_fc boolean');
      expect(sql).toContain("position('설계매니저' in coalesce(profile.affiliation, '')) = 0");
      expect(sql).toContain('order by page.latest_at desc, page.fc_id desc');
      expect(sql).toContain('page.fc_id < p_cursor_fc_id');
      expect(sql).toContain(
        'revoke all on function public.list_internal_chat_page_v1(text, boolean, integer, timestamptz, uuid)',
      );
      expect(sql).toContain(
        'grant execute on function public.list_internal_chat_page_v1(text, boolean, integer, timestamptz, uuid)',
      );
    },
  );
});
