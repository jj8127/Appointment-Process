import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import {
  buildAdminChatConversationSummaries,
  buildAdminChatTargets,
  mergeAdminChatSummaryRows,
  type AdminChatMessageSummaryRow,
  type AdminChatSourceRow,
} from '@/lib/admin-chat-targets';
import { adminSupabase } from '@/lib/admin-supabase';
import { buildPhoneCandidates, getVerifiedReadOnlyAdminSession } from '@/lib/server-session';
import { getWebStaffChatActorId, normalizeStaffType } from '@/lib/staff-identity';

export const runtime = 'nodejs';

const RECENT_CHAT_SUMMARY_LIMIT = 500;

async function getSessionStaffType(role: 'admin' | 'manager', residentDigits: string) {
  if (role !== 'admin') {
    return null;
  }

  const candidates = buildPhoneCandidates(residentDigits, residentDigits);
  const { data, error } = await adminSupabase
    .from('admin_accounts')
    .select('staff_type')
    .in('phone', candidates)
    .eq('active', true)
    .maybeSingle();

  if (error) {
    throw error;
  }

  const cookieStore = await cookies();
  return normalizeStaffType(data?.staff_type ?? cookieStore.get('session_staff_type')?.value);
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

    const staffType = await getSessionStaffType(role, residentDigits);
    const myChatId = getWebStaffChatActorId({
      role,
      residentId: residentDigits,
      staffType,
    });

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

    const summaryRows = mergeAdminChatSummaryRows(
      (recentMessagesResult.data ?? []) as AdminChatMessageSummaryRow[],
      (unreadMessagesResult.data ?? []) as AdminChatMessageSummaryRow[],
    );
    const summariesByPhone = buildAdminChatConversationSummaries({
      viewerId: myChatId,
      counterpartPhones: baseTargets.map((target) => target.phone),
      messages: summaryRows,
    });

    return NextResponse.json(buildAdminChatTargets(fcRows, summariesByPhone));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Chat list failed' },
      { status: 500 },
    );
  }
}
