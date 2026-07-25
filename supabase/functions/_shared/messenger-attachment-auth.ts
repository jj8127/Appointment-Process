import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { isTrustedFcNotifyServiceKey } from './fc-notify-auth-policy.ts';
import {
  requireAppSessionFromRequest,
  type AppSessionTokenPayload,
} from './request-board-auth.ts';
import { normalizeMessengerAttachmentUuid } from './messenger-attachment-policy.ts';

export type MessengerAttachmentActor = {
  id: string;
  role: 'fc' | 'admin' | 'manager';
  phone: string;
  displayName: string | null;
};

export type MessengerAttachmentAuthResult =
  | { ok: true; actor: MessengerAttachmentActor; trustedService: boolean }
  | { ok: false; code: string; message: string; status: number };

function digits(value: unknown): string {
  return String(value ?? '').replace(/\D/g, '');
}

async function resolveActorRecord(input: {
  supabase: SupabaseClient;
  actorId?: string | null;
  phone: string;
  role: string;
}): Promise<MessengerAttachmentAuthResult> {
  const actorId = input.actorId ? normalizeMessengerAttachmentUuid(input.actorId) : null;
  const phone = digits(input.phone);
  if (phone.length !== 11 || !['fc', 'admin', 'manager', 'developer'].includes(input.role)) {
    return {
      ok: false,
      code: 'invalid_session',
      message: '로그인이 필요합니다.',
      status: 401,
    };
  }

  if (input.role === 'fc') {
    let query = input.supabase
      .from('fc_profiles')
      .select('id,name,phone,signup_completed,is_manager_referral_shadow,affiliation');
    query = actorId ? query.eq('id', actorId) : query.eq('phone', phone);
    const { data, error } = await query.maybeSingle();
    if (error) {
      return {
        ok: false,
        code: 'attachment_database_unavailable',
        message: '첨부파일 권한을 확인하지 못했습니다.',
        status: 503,
      };
    }
    const affiliation = String(data?.affiliation ?? '').trim().toLowerCase();
    const compactAffiliation = affiliation.replace(/\s+/g, '');
    if (
      !data?.id
      || digits(data.phone) !== phone
      || data.signup_completed !== true
      || data.is_manager_referral_shadow === true
      || affiliation.startsWith('request_board_designer:')
      || compactAffiliation.includes('설계매니저')
    ) {
      return {
        ok: false,
        code: 'forbidden',
        message: '첨부파일을 사용할 권한이 없습니다.',
        status: 403,
      };
    }
    return {
      ok: true,
      actor: {
        id: data.id,
        role: 'fc',
        phone,
        displayName: typeof data.name === 'string' ? data.name.trim() || null : null,
      },
      trustedService: false,
    };
  }

  if (input.role === 'manager') {
    let query = input.supabase
      .from('manager_accounts')
      .select('id,name,phone,active');
    query = actorId ? query.eq('id', actorId) : query.eq('phone', phone);
    const { data, error } = await query.maybeSingle();
    if (error) {
      return {
        ok: false,
        code: 'attachment_database_unavailable',
        message: '첨부파일 권한을 확인하지 못했습니다.',
        status: 503,
      };
    }
    if (!data?.id || digits(data.phone) !== phone || data.active !== true) {
      return {
        ok: false,
        code: 'forbidden',
        message: '첨부파일을 사용할 권한이 없습니다.',
        status: 403,
      };
    }
    return {
      ok: true,
      actor: {
        id: data.id,
        role: 'manager',
        phone,
        displayName: typeof data.name === 'string' ? data.name.trim() || null : null,
      },
      trustedService: false,
    };
  }

  let query = input.supabase
    .from('admin_accounts')
    .select('id,name,phone,active,staff_type');
  query = actorId ? query.eq('id', actorId) : query.eq('phone', phone);
  const { data, error } = await query.maybeSingle();
  if (error) {
    return {
      ok: false,
      code: 'attachment_database_unavailable',
      message: '첨부파일 권한을 확인하지 못했습니다.',
      status: 503,
    };
  }
  if (
    !data?.id
    || digits(data.phone) !== phone
    || data.active !== true
    || !['admin', 'developer'].includes(String(data.staff_type ?? 'admin'))
    || (
      input.role === 'developer'
      && data.staff_type !== 'developer'
    )
  ) {
    return {
      ok: false,
      code: 'forbidden',
      message: '첨부파일을 사용할 권한이 없습니다.',
      status: 403,
    };
  }
  return {
    ok: true,
    actor: {
      id: data.id,
      role: 'admin',
      phone,
      displayName: typeof data.name === 'string' ? data.name.trim() || null : null,
    },
    trustedService: false,
  };
}

function sessionActorInput(session: AppSessionTokenPayload) {
  return {
    actorId: session.role === 'fc' && typeof session.fcId === 'string'
      ? session.fcId
      : null,
    phone: digits(session.phone),
    role: session.role,
  };
}

export async function resolveMessengerAttachmentActor(input: {
  req: Request;
  body: Record<string, unknown>;
  supabase: SupabaseClient;
  serviceKey: string;
}): Promise<MessengerAttachmentAuthResult> {
  const hasAppSessionHeader = input.req.headers.has('x-app-session-token');
  if (
    !hasAppSessionHeader
    && isTrustedFcNotifyServiceKey(
      input.req.headers.get('apikey'),
      input.serviceKey,
    )
  ) {
    const result = await resolveActorRecord({
      supabase: input.supabase,
      actorId: typeof input.body.viewer_actor_id === 'string'
        ? input.body.viewer_actor_id
        : null,
      phone: digits(input.body.viewer_actor_phone),
      role: String(input.body.viewer_actor_role ?? ''),
    });
    return result.ok ? { ...result, trustedService: true } : result;
  }

  const sessionResult = await requireAppSessionFromRequest(input.req);
  if (sessionResult.ok === false) {
    return {
      ok: false,
      code: sessionResult.code,
      message: sessionResult.message,
      status: sessionResult.status,
    };
  }
  return await resolveActorRecord({
    supabase: input.supabase,
    ...sessionActorInput(sessionResult.session),
  });
}

export async function canActorAccessMessengerAttachmentBatch(input: {
  supabase: SupabaseClient;
  actor: MessengerAttachmentActor;
  batchId: string;
}): Promise<boolean> {
  const batchId = normalizeMessengerAttachmentUuid(input.batchId);
  if (!batchId) return false;
  const { data, error } = await input.supabase
    .from('messenger_attachment_delivery_batches')
    .select('id,actor_id,actor_role,context_kind,conversation_id,room_id,conversation_ids,status')
    .eq('id', batchId)
    .maybeSingle();
  if (error || !data?.id || data.status !== 'committed') return false;
  if (data.context_kind === 'group') {
    if (input.actor.role !== 'fc') return true;
    const { data: room } = await input.supabase
      .from('group_chat_rooms')
      .select('id,is_active')
      .eq('id', data.room_id)
      .maybeSingle();
    return room?.is_active === true;
  }
  if (data.context_kind === 'direct') {
    if (input.actor.role === 'admin' || input.actor.role === 'manager') return true;
    if (input.actor.role !== 'fc') return false;
    const { data: conversation } = await input.supabase
      .from('garamin_direct_conversations')
      .select('fc_id')
      .eq('id', data.conversation_id)
      .maybeSingle();
    return conversation?.fc_id === input.actor.id;
  }
  if (data.context_kind === 'direct_broadcast') {
    // The GaramIn admin direct-chat inbox is shared across active admins and
    // developers, so broadcast attachments follow the same read boundary.
    if (input.actor.role === 'admin') return true;
    if (input.actor.role !== 'fc' || !Array.isArray(data.conversation_ids)) return false;
    const { data: conversations } = await input.supabase
      .from('garamin_direct_conversations')
      .select('id')
      .eq('fc_id', input.actor.id)
      .in('id', data.conversation_ids);
    return (conversations?.length ?? 0) > 0;
  }
  return false;
}
