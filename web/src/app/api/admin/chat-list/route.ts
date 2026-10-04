import { NextResponse } from 'next/server';

import {
  buildAdminChatConversationSummaries,
  buildAdminChatTargets,
  mergeAdminChatSummaryRows,
  type AdminChatMessageSummaryRow,
  type AdminChatSourceRow,
} from '@/lib/admin-chat-targets';
import { adminSupabase } from '@/lib/admin-supabase';
import { getVerifiedReadOnlyAdminSession } from '@/lib/server-session';


export const runtime = 'nodejs';

const RECENT_CHAT_SUMMARY_LIMIT = 500;

// Keep UUID filters below proxy URL limits, including accounts with many messages.
const QUERY_ID_BATCH_SIZE = 100;
function idBatches(ids: string[]) {
  const batches: string[][] = [];
  const uniqueIds = [...new Set(ids)];
  for (let offset = 0; offset < uniqueIds.length; offset += QUERY_ID_BATCH_SIZE) {
    batches.push(uniqueIds.slice(offset, offset + QUERY_ID_BATCH_SIZE));
  }
  return batches;
}

export async function GET() {
  const sessionCheck = await getVerifiedReadOnlyAdminSession();
  if (!sessionCheck.ok) {
    return NextResponse.json({ error: sessionCheck.error }, { status: sessionCheck.status });
  }

  try {
    const { role, residentDigits } = sessionCheck.session;
    if (role !== 'admin' && role !== 'manager') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { staffType, accountId } = sessionCheck.session;
    // New direct threads bind every staff account to its own signed phone.
    const myChatId = residentDigits;
    const counterpartyRole = role === 'manager' ? 'manager' : staffType === 'developer' ? 'developer' : 'admin';

    const [participantsResult, recentMessagesResult, unreadMessagesResult] = await Promise.all([
      adminSupabase
        .from('fc_profiles')
        .select('id,name,phone,signup_completed,affiliation')
        .eq('signup_completed', true)
        .order('created_at', { ascending: false }),
      adminSupabase
        .from('messages')
        .select('id,sender_id,receiver_id,content,created_at,is_read')
        .or(`sender_id.eq.${myChatId},receiver_id.eq.${myChatId}`)
        .order('created_at', { ascending: false })
        .limit(RECENT_CHAT_SUMMARY_LIMIT),
      adminSupabase
        .from('messages')
        .select('id,sender_id,receiver_id,content,created_at,is_read')
        .eq('receiver_id', myChatId)
        .eq('is_read', false),
    ]);

    if (participantsResult.error) throw participantsResult.error;
    if (recentMessagesResult.error) throw recentMessagesResult.error;
    if (unreadMessagesResult.error) throw unreadMessagesResult.error;

    const fcRows = (participantsResult.data ?? []) as AdminChatSourceRow[];
    const baseTargets = buildAdminChatTargets(fcRows);
    if (baseTargets.length === 0) {
      return NextResponse.json([]);
    }

    const rawSummaryRows = mergeAdminChatSummaryRows(
      (recentMessagesResult.data ?? []) as AdminChatMessageSummaryRow[],
      (unreadMessagesResult.data ?? []) as AdminChatMessageSummaryRow[],
    );
    const summaryMessageIds = rawSummaryRows
      .map((row) => String(row.id ?? '').trim())
      .filter(Boolean);
    const attachmentCountByMessageId = new Map<string, number>();
    const requestedMessageIds = new Set(summaryMessageIds);
    const countedBatchIds = new Set<string>();
    for (const messageIds of idBatches(summaryMessageIds)) {
      // Links belong to a delivery batch, whose committed_message_ids bind its messages.
      const { data: batches, error: batchesError } = await adminSupabase
        .from('messenger_attachment_delivery_batches')
        .select('id,committed_message_ids,messenger_message_attachments(sort_order)')
        .in('context_kind', ['direct', 'direct_broadcast'])
        .eq('status', 'committed')
        .is('deleted_at', null)
        .overlaps('committed_message_ids', messageIds);
      if (batchesError) throw batchesError;
      for (const batch of batches ?? []) {
        if (countedBatchIds.has(batch.id)) continue;
        countedBatchIds.add(batch.id);
        const count = Array.isArray(batch.messenger_message_attachments)
          ? batch.messenger_message_attachments.length : 0;
        for (const messageId of batch.committed_message_ids ?? []) {
          if (!requestedMessageIds.has(messageId)) continue;
          attachmentCountByMessageId.set(messageId, (attachmentCountByMessageId.get(messageId) ?? 0) + count);
        }
      }
    }
    const summaryRows = rawSummaryRows.map((row) => ({
      ...row,
      attachment_count: attachmentCountByMessageId.get(String(row.id ?? '').trim()) ?? 0,
    }));
    const summariesByPhone = buildAdminChatConversationSummaries({
      viewerId: myChatId,
      counterpartPhones: baseTargets.map((target) => target.phone),
      messages: summaryRows,
    });

    const targets = buildAdminChatTargets(fcRows, summariesByPhone);
    const conversationByFcId = new Map<string, string>();
    for (const fcIds of idBatches(targets.map((target) => target.fc_id))) {
      const { data: conversations, error: conversationError } = await adminSupabase
        .from('garamin_direct_conversations')
        .select('id,fc_id')
        .in('fc_id', fcIds);
      if (conversationError) throw conversationError;
      const fcByLegacyId = new Map((conversations ?? []).map((row) => [row.id, row.fc_id]));
      if (fcByLegacyId.size === 0) continue;
      const { data: threads, error: threadError } = await adminSupabase
        .from('garamin_direct_threads')
        .select('id,legacy_conversation_id')
        .in('legacy_conversation_id', [...fcByLegacyId.keys()])
        .eq('counterparty_role', counterpartyRole)
        .eq('counterparty_actor_id', accountId);
      if (threadError) throw threadError;
      for (const thread of threads ?? []) {
        const fcId = fcByLegacyId.get(thread.legacy_conversation_id);
        if (fcId) conversationByFcId.set(fcId, thread.id);
      }
    }
    return NextResponse.json(targets.map((target) => ({
      ...target,
      conversation_id: conversationByFcId.get(target.fc_id) ?? null,
    })));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Chat list failed' },
      { status: 500 },
    );
  }
}
