import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

type Payload = {
  residentId?: string;
  residentMask?: string;
  fcId?: string;
  role?: 'fc' | 'admin' | 'manager';
  roleHint?: 'fc' | 'admin' | 'manager';
};

type AccountRole = 'fc' | 'admin' | 'manager';

type FcProfileRow = {
  id: string;
  phone: string | null;
};

type AccountRow = {
  id: string;
  phone: string | null;
};

type FcDocumentRow = {
  storage_path: string | null;
};

type BoardPostRow = {
  id: string;
};

type BoardAttachmentRow = {
  storage_path: string | null;
};

type ChatFileRow = {
  file_url: string | null;
};

type LinkedProfileRow = {
  id: string;
};

function getEnv(name: string): string | undefined {
  const g: any = globalThis as any;
  if (g?.Deno?.env?.get) return g.Deno.env.get(name);
  if (g?.process?.env) return g.process.env[name];
  return undefined;
}

// Security: Restrict CORS to specific origins
const allowedOrigins = (getEnv('ALLOWED_ORIGINS') ?? '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);
const corsHeaders = {
  'Access-Control-Allow-Origin': allowedOrigins.length > 0 ? allowedOrigins[0] : 'https://yourdomain.com',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-client-info, apikey',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Credentials': 'true',
};

// Security: Validate required environment variables
const supabaseUrl = getEnv('SUPABASE_URL');
const serviceKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');

if (!supabaseUrl) {
  throw new Error('Missing required environment variable: SUPABASE_URL');
}
if (!serviceKey) {
  throw new Error('Missing required environment variable: SUPABASE_SERVICE_ROLE_KEY');
}

const supabase = createClient(supabaseUrl, serviceKey);

function ok(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

function err(message: string, status = 400) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

async function ignoreMissingTable<T>(result: { error: any; data?: T }) {
  if (result.error?.code === '42P01') {
    return { data: result.data };
  }
  if (result.error) {
    throw result.error;
  }
  return result;
}

async function ignoreMissingTableOrColumn<T>(result: { error: any; data?: T }) {
  if (result.error?.code === '42P01' || result.error?.code === '42703') {
    return { data: result.data };
  }
  if (result.error) {
    throw result.error;
  }
  return result;
}

function cleanPhone(input: string) {
  return (input ?? '').replace(/[^0-9]/g, '');
}

function formatPhone(digits: string) {
  if (!digits) return '';
  if (digits.length <= 3) return digits;
  if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
}

function buildResidentIds(phone: string | null | undefined) {
  const raw = String(phone ?? '').trim();
  const digits = cleanPhone(raw);
  const values = new Set<string>();

  if (digits) values.add(digits);
  if (raw) values.add(raw);
  if (digits) {
    const masked = formatPhone(digits);
    if (masked) values.add(masked);
  }

  return Array.from(values).filter(Boolean);
}

function extractChatUploadPath(fileUrl: string | null | undefined): string | null {
  const raw = String(fileUrl ?? '').trim();
  if (!raw) return null;
  const marker = '/chat-uploads/';
  const idx = raw.indexOf(marker);
  if (idx < 0) return null;
  const withBucket = raw.slice(idx + marker.length);
  const pathOnly = withBucket.split('?')[0] ?? '';
  const normalized = pathOnly.replace(/^\/+/, '');
  return normalized || null;
}

async function pickProfileByEq(
  column: 'id' | 'phone' | 'resident_id_masked',
  value: string,
): Promise<FcProfileRow | null> {
  const { data, error } = await supabase
    .from('fc_profiles')
    .select('id,phone')
    .eq(column, value)
    .limit(1);

  if (error) {
    throw error;
  }

  const list = (data ?? []) as FcProfileRow[];
  return list[0] ?? null;
}

async function resolveProfile(payload: Payload): Promise<FcProfileRow | null> {
  const rawResident = String(payload.residentId ?? '').trim();
  const residentMask = String(payload.residentMask ?? '').trim();
  const rawFcId = String(payload.fcId ?? '').trim();
  const residentDigits = cleanPhone(rawResident);

  if (rawFcId) {
    const byId = await pickProfileByEq('id', rawFcId);
    if (byId) return byId;
  }

  if (residentDigits) {
    const byPhoneDigits = await pickProfileByEq('phone', residentDigits);
    if (byPhoneDigits) return byPhoneDigits;
  }

  if (rawResident && rawResident !== residentDigits) {
    const byPhoneRaw = await pickProfileByEq('phone', rawResident);
    if (byPhoneRaw) return byPhoneRaw;
  }

  if (residentMask) {
    const byMask = await pickProfileByEq('resident_id_masked', residentMask);
    if (byMask) return byMask;
  }

  if (rawResident && rawResident.includes('-')) {
    const byMaskRaw = await pickProfileByEq('resident_id_masked', rawResident);
    if (byMaskRaw) return byMaskRaw;
  }

  return null;
}

function isRoleHint(value: unknown): value is AccountRole {
  return value === 'fc' || value === 'admin' || value === 'manager';
}

function buildPhoneCandidates(payload: Payload) {
  const residentIdRaw = String(payload.residentId ?? '').trim();
  const residentMask = String(payload.residentMask ?? '').trim();
  const values = new Set<string>();
  if (residentIdRaw) values.add(residentIdRaw);
  const residentIdDigits = cleanPhone(residentIdRaw);
  if (residentIdDigits) values.add(residentIdDigits);
  if (residentMask) values.add(residentMask);
  const residentMaskDigits = cleanPhone(residentMask);
  if (residentMaskDigits) values.add(residentMaskDigits);
  return Array.from(values).filter(Boolean);
}

async function pickAccountByPhone(
  table: 'admin_accounts' | 'manager_accounts',
  value: string,
): Promise<AccountRow | null> {
  const { data, error } = await supabase
    .from(table)
    .select('id,phone')
    .eq('phone', value)
    .limit(1);

  if (error) {
    throw error;
  }

  const list = (data ?? []) as AccountRow[];
  return list[0] ?? null;
}

async function resolveRoleAccount(
  table: 'admin_accounts' | 'manager_accounts',
  payload: Payload,
): Promise<AccountRow | null> {
  const candidates = buildPhoneCandidates(payload);
  for (const raw of candidates) {
    const digits = cleanPhone(raw);
    const attempts = new Set<string>();
    if (raw) attempts.add(raw);
    if (digits) attempts.add(digits);
    for (const candidate of attempts) {
      const row = await pickAccountByPhone(table, candidate);
      if (row) return row;
    }
  }
  return null;
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return err('Method not allowed', 405);
  }
  if (!supabaseUrl || !serviceKey) {
    return err('Server misconfigured: missing Supabase credentials', 500);
  }

  let body: Payload;
  try {
    body = await req.json();
  } catch {
    return err('Invalid JSON', 400);
  }

  const residentIdRaw = String(body.residentId ?? '').trim();
  const residentMask = String(body.residentMask ?? '').trim();
  const fcIdFromBody = String(body.fcId ?? '').trim();
  const residentIdDigits = cleanPhone(residentIdRaw);
  const roleHint = isRoleHint(body.role) ? body.role : isRoleHint(body.roleHint) ? body.roleHint : null;

  if (!residentIdRaw && !residentMask && !fcIdFromBody) {
    return err('residentId or fcId required', 400);
  }

  const roleSearchOrder: AccountRole[] = roleHint ? [roleHint] : ['fc', 'admin', 'manager'];
  let resolvedRole: AccountRole | null = null;
  let profile: FcProfileRow | null = null;
  let roleAccount: AccountRow | null = null;

  try {
    for (const role of roleSearchOrder) {
      if (role === 'fc') {
        profile = await resolveProfile(body);
        if (profile?.id) {
          resolvedRole = 'fc';
          break;
        }
        continue;
      }

      if (role === 'admin') {
        roleAccount = await resolveRoleAccount('admin_accounts', body);
        if (roleAccount?.id) {
          resolvedRole = 'admin';
          break;
        }
        continue;
      }

      roleAccount = await resolveRoleAccount('manager_accounts', body);
      if (roleAccount?.id) {
        resolvedRole = 'manager';
        break;
      }
    }
  } catch (resolveError) {
    const message = resolveError instanceof Error ? resolveError.message : 'Account lookup failed';
    return err(message, 500);
  }

  if (!resolvedRole) {
    return err('Account not found', 404);
  }

  const resolvedPhone =
    resolvedRole === 'fc'
      ? cleanPhone(profile?.phone ?? '') || residentIdDigits || cleanPhone(residentMask)
      : cleanPhone(roleAccount?.phone ?? '') || residentIdDigits || cleanPhone(residentMask);
  const residentIds = Array.from(
    new Set([
      ...buildResidentIds(resolvedPhone),
      residentIdRaw,
      residentMask,
      residentIdDigits,
    ].filter(Boolean)),
  );
  const fcId = resolvedRole === 'fc' ? profile?.id ?? null : null;

  const deleteByResident = async (table: string, column: string) => {
    if (residentIds.length === 0) return { data: null };
    if (residentIds.length === 1) {
      return ignoreMissingTable(await supabase.from(table).delete().eq(column, residentIds[0]));
    }
    return ignoreMissingTable(await supabase.from(table).delete().in(column, residentIds));
  };

  const selectPostsByResident = async () => {
    if (residentIds.length === 0) return { data: [] as BoardPostRow[] };
    if (residentIds.length === 1) {
      return ignoreMissingTable(
        await supabase.from('board_posts').select('id').eq('author_resident_id', residentIds[0]),
      );
    }
    return ignoreMissingTable(
      await supabase.from('board_posts').select('id').in('author_resident_id', residentIds),
    );
  };

  // 1) FC 문서 스토리지 정리
  if (fcId) {
    const docsResult = await ignoreMissingTable(
      await supabase.from('fc_documents').select('storage_path').eq('fc_id', fcId),
    );
    const docPaths = ((docsResult.data ?? []) as FcDocumentRow[])
      .map((doc) => doc.storage_path)
      .filter((p): p is string => !!p && p !== 'deleted');
    if (docPaths.length > 0) {
      const { error: storageError } = await supabase.storage.from('fc-documents').remove(docPaths);
      if (storageError) {
        console.warn('[delete-account] fc-documents storage remove failed', storageError.message ?? storageError);
      }
    }
  }

  // 2) 게시판 관련 삭제 (likes/reactions/comments/posts + attachments)
  await deleteByResident('board_comment_likes', 'resident_id');
  await deleteByResident('board_post_reactions', 'resident_id');
  await deleteByResident('board_post_views', 'resident_id');
  await deleteByResident('board_comments', 'author_resident_id');

  const postsResult = await selectPostsByResident();
  const postIds = ((postsResult.data ?? []) as BoardPostRow[]).map((p) => p.id);
  if (postIds.length > 0) {
    const postAttachmentsResult = await ignoreMissingTable(
      await supabase.from('board_attachments').select('storage_path').in('post_id', postIds),
    );
    const boardAttachmentPaths = ((postAttachmentsResult.data ?? []) as BoardAttachmentRow[])
      .map((a) => a.storage_path)
      .filter((p): p is string => !!p);
    if (boardAttachmentPaths.length > 0) {
      const { error: boardStorageError } = await supabase.storage
        .from('board-attachments')
        .remove(boardAttachmentPaths);
      if (boardStorageError) {
        console.warn(
          '[delete-account] board-attachments storage remove failed',
          boardStorageError.message ?? boardStorageError,
        );
      }
    }
    await ignoreMissingTable(await supabase.from('board_posts').delete().in('id', postIds));
  }

  // 3) 채팅 첨부 스토리지 정리 (FC가 보낸 파일만)
  if (residentIds.length > 0) {
    let chatFileQuery = supabase.from('messages').select('file_url').in('message_type', ['image', 'file']);
    chatFileQuery =
      residentIds.length === 1
        ? chatFileQuery.eq('sender_id', residentIds[0])
        : chatFileQuery.in('sender_id', residentIds);
    const chatFilesResult = await ignoreMissingTable(await chatFileQuery);
    const chatPaths = Array.from(
      new Set(
        ((chatFilesResult.data ?? []) as ChatFileRow[])
          .map((m) => extractChatUploadPath(m.file_url))
          .filter((p): p is string => !!p),
      ),
    );
    if (chatPaths.length > 0) {
      const { error: chatStorageError } = await supabase.storage.from('chat-uploads').remove(chatPaths);
      if (chatStorageError) {
        console.warn('[delete-account] chat-uploads storage remove failed', chatStorageError.message ?? chatStorageError);
      }
    }
  }

  // 4) resident/fc 연관 레코드 삭제
  if (fcId) {
    await ignoreMissingTable(await supabase.from('fc_documents').delete().eq('fc_id', fcId));
    await ignoreMissingTable(await supabase.from('fc_credentials').delete().eq('fc_id', fcId));
    await ignoreMissingTable(await supabase.from('fc_identity_secure').delete().eq('fc_id', fcId));
    await ignoreMissingTable(await supabase.from('exam_registrations').delete().eq('fc_id', fcId));
    await ignoreMissingTable(await supabase.from('notifications').delete().eq('fc_id', fcId));
  }

  await deleteByResident('messages', 'sender_id');
  await deleteByResident('messages', 'receiver_id');
  await deleteByResident('exam_registrations', 'resident_id');
  await deleteByResident('notifications', 'resident_id');
  await deleteByResident('device_tokens', 'resident_id');
  await deleteByResident('web_push_subscriptions', 'resident_id');
  await deleteByResident('board_attachments', 'created_by_resident_id');
  await ignoreMissingTable(
    residentIds.length <= 1
      ? await supabase
          .from('user_presence')
          .delete()
          .eq('phone', residentIds[0] ?? '')
      : await supabase
          .from('user_presence')
          .delete()
          .in('phone', residentIds),
  );
  await ignoreMissingTableOrColumn(
    residentIds.length <= 1
      ? await supabase
          .from('notices')
          .delete()
          .eq('created_by', residentIds[0] ?? '')
      : await supabase
          .from('notices')
          .delete()
          .in('created_by', residentIds),
  );

  // 5) auth/profiles bridge 정리
  if (fcId) {
    const linkedProfilesResult = await ignoreMissingTable(
      await supabase.from('profiles').select('id').eq('fc_id', fcId),
    );
    const linkedProfileIds = ((linkedProfilesResult.data ?? []) as LinkedProfileRow[]).map((row) => row.id);
    for (const profileId of linkedProfileIds) {
      const { error: authDeleteError } = await supabase.auth.admin.deleteUser(profileId);
      if (authDeleteError) {
        console.warn('[delete-account] auth user delete failed', profileId, authDeleteError.message ?? authDeleteError);
      }
    }
    await ignoreMissingTable(await supabase.from('profiles').delete().eq('fc_id', fcId));
  }

  // 6) 최종 프로필 삭제
  if (resolvedRole === 'fc' && fcId) {
    const { error: profileDeleteError } = await supabase.from('fc_profiles').delete().eq('id', fcId);
    if (profileDeleteError) return err(profileDeleteError.message, 500);
  }

  if (resolvedRole === 'admin' && roleAccount?.id) {
    const { error: adminDeleteError } = await supabase.from('admin_accounts').delete().eq('id', roleAccount.id);
    if (adminDeleteError) return err(adminDeleteError.message, 500);
  }

  if (resolvedRole === 'manager' && roleAccount?.id) {
    const managerPhone = cleanPhone(roleAccount.phone ?? '');
    if (managerPhone) {
      await ignoreMissingTable(
        await supabase
          .from('affiliation_manager_mappings')
          .delete()
          .eq('manager_phone', managerPhone),
      );
    }
    const { error: managerDeleteError } = await supabase.from('manager_accounts').delete().eq('id', roleAccount.id);
    if (managerDeleteError) return err(managerDeleteError.message, 500);
  }

  if (residentIds.length > 0) {
    const fcRemainingResult =
      residentIds.length === 1
        ? await supabase.from('fc_profiles').select('id', { count: 'exact', head: true }).eq('phone', residentIds[0])
        : await supabase.from('fc_profiles').select('id', { count: 'exact', head: true }).in('phone', residentIds);
    if (fcRemainingResult.error) return err(fcRemainingResult.error.message, 500);

    const adminRemainingResult =
      residentIds.length === 1
        ? await supabase.from('admin_accounts').select('id', { count: 'exact', head: true }).eq('phone', residentIds[0])
        : await supabase.from('admin_accounts').select('id', { count: 'exact', head: true }).in('phone', residentIds);
    if (adminRemainingResult.error) return err(adminRemainingResult.error.message, 500);

    const managerRemainingResult =
      residentIds.length === 1
        ? await supabase.from('manager_accounts').select('id', { count: 'exact', head: true }).eq('phone', residentIds[0])
        : await supabase.from('manager_accounts').select('id', { count: 'exact', head: true }).in('phone', residentIds);
    if (managerRemainingResult.error) return err(managerRemainingResult.error.message, 500);

    const remainingBlockers = {
      fc_profiles: fcRemainingResult.count ?? 0,
      admin_accounts: adminRemainingResult.count ?? 0,
      manager_accounts: managerRemainingResult.count ?? 0,
    };

    if (remainingBlockers.fc_profiles > 0 || remainingBlockers.admin_accounts > 0 || remainingBlockers.manager_accounts > 0) {
      return err(`Account cleanup incomplete: ${JSON.stringify(remainingBlockers)}`, 500);
    }
  }

  return ok({ ok: true, deleted: true, role: resolvedRole });
});
