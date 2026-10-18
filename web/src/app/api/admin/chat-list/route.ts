import { NextResponse } from 'next/server';

import {
  buildAdminChatTargets,
  isAdminChatConversationRow,
  isAdminChatSourceRow,
  isAdminChatThreadRow,
  type AdminChatConversationSummary,
  type AdminChatConversationRow,
  type AdminChatSourceRow,
  type AdminChatThreadRow,
} from '@/lib/admin-chat-targets';
import { adminSupabase } from '@/lib/admin-supabase';
import { serverError } from '@/lib/api-error';
import { getVerifiedReadOnlyAdminSession } from '@/lib/server-session';
import { collectSupabaseRows } from '@/lib/supabase-query-contract';

export const runtime = 'nodejs';

const QUERY_PAGE_SIZE = 500;

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

type AdminChatSummaryRpcRow = {
  target_id: string;
  last_message: string | null;
  last_time: string | null;
  unread_count: number;
};

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value !== null && typeof value === 'object' && !Array.isArray(value)
);

function isAdminChatSummaryRpcRow(value: unknown): value is AdminChatSummaryRpcRow {
  return isRecord(value)
    && typeof value.target_id === 'string'
    && value.target_id.trim().length > 0
    && (value.last_message === null || typeof value.last_message === 'string')
    && (value.last_time === null
      || (typeof value.last_time === 'string' && Number.isFinite(Date.parse(value.last_time))))
    && Number.isSafeInteger(value.unread_count)
    && Number(value.unread_count) >= 0;
}

async function fetchAdminChatSummaries(
  viewerId: string,
  counterpartPhones: string[],
): Promise<Record<string, AdminChatConversationSummary>> {
  const chunks = idBatches(counterpartPhones);
  const chunkRows = await Promise.all(chunks.map(async (targetIds) => {
    const { data, error } = await adminSupabase.rpc('get_internal_messenger_summaries_v1', {
      p_viewer_id: viewerId,
      p_target_ids: targetIds,
    });
    if (error) throw error;
    if (!Array.isArray(data) || !data.every(isAdminChatSummaryRpcRow)) {
      throw new Error('admin_chat_summary_query_contract_invalid');
    }
    const requestedTargets = new Set(targetIds);
    const returnedTargets = new Set(data.map((row) => row.target_id.trim()));
    if (returnedTargets.size !== data.length
      || returnedTargets.size !== requestedTargets.size
      || [...returnedTargets].some((targetId) => !requestedTargets.has(targetId))
    ) {
      throw new Error('admin_chat_summary_relation_contract_invalid');
    }
    return data;
  }));

  return Object.fromEntries(chunkRows.flat().map((row) => [row.target_id.trim(), {
    last_message: row.last_message,
    last_time: row.last_time,
    unread_count: row.unread_count,
  }]));
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

    const fcRows = await collectSupabaseRows<AdminChatSourceRow>({
      queryName: 'admin_chat_participants',
      pageSize: QUERY_PAGE_SIZE,
      rowKey: (row) => row.id,
      isRow: isAdminChatSourceRow,
      fetchPage: async (from, to) => await adminSupabase
        .from('fc_profiles')
        .select('id,name,phone,signup_completed,affiliation')
        .eq('signup_completed', true)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .range(from, to),
    });
    if (fcRows.some((row) => !row.signup_completed)) {
      throw new Error('admin_chat_participant_relation_contract_invalid');
    }
    const baseTargets = buildAdminChatTargets(fcRows);
    if (baseTargets.length === 0) {
      return NextResponse.json([]);
    }

    const summariesByPhone = await fetchAdminChatSummaries(
      myChatId,
      baseTargets.map((target) => target.phone),
    );

    const targets = buildAdminChatTargets(fcRows, summariesByPhone);
    const conversationByFcId = new Map<string, string>();
    for (const fcIds of idBatches(targets.map((target) => target.fc_id))) {
      const requestedFcIds = new Set(fcIds);
      const conversationRows = await collectSupabaseRows<AdminChatConversationRow>({
        queryName: 'admin_chat_conversations',
        pageSize: QUERY_ID_BATCH_SIZE,
        maxRows: QUERY_ID_BATCH_SIZE,
        rowKey: (row) => row.id,
        isRow: isAdminChatConversationRow,
        fetchPage: async (from, to) => await adminSupabase
          .from('garamin_direct_conversations')
          .select('id,fc_id')
          .in('fc_id', fcIds)
          .order('fc_id', { ascending: true })
          .order('id', { ascending: true })
          .range(from, to),
      });
      const seenFcIds = new Set<string>();
      const fcByLegacyId = new Map<string, string>();
      for (const row of conversationRows) {
        const conversationId = row.id.trim();
        const fcId = row.fc_id.trim();
        if (!requestedFcIds.has(fcId) || seenFcIds.has(fcId)) {
          throw new Error('admin_chat_conversation_relation_contract_invalid');
        }
        seenFcIds.add(fcId);
        fcByLegacyId.set(conversationId, fcId);
      }
      if (fcByLegacyId.size === 0) continue;
      const legacyConversationIds = [...fcByLegacyId.keys()];
      const requestedConversationIds = new Set(legacyConversationIds);
      const threads = await collectSupabaseRows<AdminChatThreadRow>({
        queryName: 'admin_chat_threads',
        pageSize: QUERY_ID_BATCH_SIZE,
        maxRows: QUERY_ID_BATCH_SIZE,
        rowKey: (row) => row.id,
        isRow: isAdminChatThreadRow,
        fetchPage: async (from, to) => await adminSupabase
          .from('garamin_direct_threads')
          .select('id,legacy_conversation_id')
          .in('legacy_conversation_id', legacyConversationIds)
          .eq('counterparty_role', counterpartyRole)
          .eq('counterparty_actor_id', accountId)
          .order('legacy_conversation_id', { ascending: true })
          .order('id', { ascending: true })
          .range(from, to),
      });
      const seenConversationIds = new Set<string>();
      for (const thread of threads) {
        const threadId = thread.id.trim();
        const legacyConversationId = thread.legacy_conversation_id.trim();
        if (!requestedConversationIds.has(legacyConversationId)
          || seenConversationIds.has(legacyConversationId)
        ) {
          throw new Error('admin_chat_thread_relation_contract_invalid');
        }
        seenConversationIds.add(legacyConversationId);
        const fcId = fcByLegacyId.get(legacyConversationId);
        if (!fcId || conversationByFcId.has(fcId)) {
          throw new Error('admin_chat_thread_mapping_contract_invalid');
        }
        conversationByFcId.set(fcId, threadId);
      }
    }
    return NextResponse.json(targets.map((target) => ({
      ...target,
      conversation_id: conversationByFcId.get(target.fc_id) ?? null,
    })));
  } catch (error) {
    return serverError(error, 'api/admin/chat-list');
  }
}
