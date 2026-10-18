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
    expect(helper).toContain('parseQueryRows(data, isInternalMessengerSummaryQueryRow)');
    expect(helper).toContain('rows.some((row) => !targetIdSet.has(row.target_id.trim()))');
    expect(helper).not.toContain('(data ?? [])');
  });

  test('paged RPC rejects malformed successes instead of filtering rows into an empty result', () => {
    const internalListStart = edge.indexOf("if (body.type === 'internal_chat_list')");
    const unreadStart = edge.indexOf("if (body.type === 'internal_unread_count')", internalListStart);
    const internalList = edge.slice(internalListStart, unreadStart);

    expect(internalList).toContain(
      'const pageRows = parseQueryRows(pageRowPayload, isInternalChatPageQueryRow)',
    );
    expect(internalList).toContain("return err('Internal chat list failed', 500)");
    expect(internalList).not.toContain('rawPageRows ?? []');
    expect(internalList).not.toContain('.filter((row): row is InternalChatPageRow => row !== null)');
  });

  test('preserves the validated database cursor timestamp without millisecond truncation', () => {
    const internalListStart = edge.indexOf("if (body.type === 'internal_chat_list')");
    const unreadStart = edge.indexOf("if (body.type === 'internal_unread_count')", internalListStart);
    const internalList = edge.slice(internalListStart, unreadStart);

    expect(internalList).toContain("typeof latestAt !== 'string'");
    expect(internalList).toContain('Number.isFinite(Date.parse(latestAt))');
    expect(internalList).toContain('cursorLatestAt = latestAt');
    expect(internalList).toContain('latest_at: row.latest_at as string');
    expect(internalList).not.toContain('new Date(latestAt).toISOString()');
    expect(internalList).not.toContain('new Date(String(row.latest_at)).toISOString()');
  });

  test('legacy summaries and chat history exhaust every stable message page', () => {
    const legacySummaryStart = edge.indexOf('async function fetchLegacyInternalMessengerSummaries');
    const receiptStart = edge.indexOf('function buildNotificationReceiptViewer', legacySummaryStart);
    const compatibility = edge.slice(legacySummaryStart, receiptStart);
    const profilesStart = edge.indexOf('function fetchInternalFcProfiles');
    const actorStart = edge.indexOf('type FcNotifyActorResolution', profilesStart);
    const profiles = edge.slice(profilesStart, actorStart);

    expect(compatibility.match(/collectSupabaseRows<LegacyInternalMessageQueryRow>\(\{/g)).toHaveLength(2);
    expect(compatibility.match(/isRow: isLegacyInternalMessageQueryRow/g)).toHaveLength(2);
    expect(compatibility.match(/rowKey: \(row\) => row\.id/g)).toHaveLength(2);
    expect(compatibility.match(/\.order\('created_at', \{ ascending: false \}\)/g)).toHaveLength(2);
    expect(compatibility.match(/\.order\('id', \{ ascending: false \}\)/g)).toHaveLength(2);
    expect(compatibility.match(/\.range\(from, to\)/g)).toHaveLength(2);
    expect(compatibility).toContain(
      "'id,sender_id,receiver_id,content,created_at,is_read,file_name,attachment_batch_id,deleted_at'",
    );
    expect(profiles).toContain('collectSupabaseRows<InternalFcProfileQueryRow>({');
    expect(profiles).toContain('isRow: isInternalFcProfileQueryRow');
    expect(profiles).toContain('rowKey: (row) => row.id');
    expect(profiles).toContain(".order('id', { ascending: true })");
    expect(profiles).toContain('.range(from, to)');
  });

  test('missing page RPC fallback preserves the database keyset and limit-plus-one contract', () => {
    const internalListStart = edge.indexOf("if (body.type === 'internal_chat_list')");
    const unreadStart = edge.indexOf("if (body.type === 'internal_unread_count')", internalListStart);
    const internalList = edge.slice(internalListStart, unreadStart);
    const fallbackStart = internalList.indexOf('if (pageError)');
    const normalizedStart = internalList.indexOf('const pageRows = parseQueryRows', fallbackStart);
    const fallback = internalList.slice(fallbackStart, normalizedStart);

    expect(internalList).toContain('let pageRowPayload: unknown = rawPageRows');
    expect(internalList).toContain('latest_at: item.last_time ?? INTERNAL_CHAT_EPOCH');
    expect(internalList).toContain('Date.parse(right.latest_at) - Date.parse(left.latest_at)');
    expect(internalList).toContain('right.fc_id.localeCompare(left.fc_id)');
    expect(internalList).toContain('rowTimestamp < cursorTimestamp');
    expect(internalList).toContain('row.fc_id < cursorFcId');
    expect(internalList).toContain(
      'pageRowPayload = legacyRows.slice(0, paginated ? pageLimit + 1 : pageLimit)',
    );
    expect(internalList).toContain('const hasMore = paginated && normalizedRows.length > pageLimit');
    expect(fallback).not.toContain('return ok(');
  });

  test('chunks the complete internal participant set before exact unread counts', () => {
    const unreadStart = edge.indexOf("if (body.type === 'internal_unread_count')");
    const inboxStart = edge.indexOf("if (body.type === 'inbox_list')", unreadStart);
    const unread = edge.slice(unreadStart, inboxStart);

    expect(unread).toMatch(/Array\.from\(\s*new Set\(/);
    expect(unread).toContain('for (const senderBatch of chunkSupabaseFilterValues(scopedSenderIds))');
    expect(unread).toContain(".in('sender_id', senderBatch)");
    expect(unread).toContain('const batchCount = parseQueryCount(count)');
    expect(unread).toContain('!Number.isSafeInteger(exactCount + batchCount)');
  });

  test('chat targets require strict account and mapping row arrays', () => {
    const chatTargetsStart = edge.indexOf("if (body.type === 'chat_targets')");
    const internalListStart = edge.indexOf("if (body.type === 'internal_chat_list')", chatTargetsStart);
    const chatTargets = edge.slice(chatTargetsStart, internalListStart);

    expect(chatTargets).toContain('parseQueryRows(managers, isChatTargetManagerQueryRow)');
    expect(chatTargets).toContain('parseQueryRows(developers, isChatTargetStaffQueryRow)');
    expect(chatTargets).toContain('parseQueryRows(admins, isChatTargetStaffQueryRow)');
    expect(chatTargets).toMatch(
      /parseQueryRows\(\s*managerMappings,\s*isAffiliationManagerMappingQueryRow/,
    );
    expect(chatTargets).toContain("return err('Chat target lookup failed', 500)");
    expect(chatTargets).not.toMatch(/return err\([^\n]*\.message, 500\)/);
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
    expect(internalList).not.toMatch(/return err\([^\n]*\.message, 500\)/);
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
