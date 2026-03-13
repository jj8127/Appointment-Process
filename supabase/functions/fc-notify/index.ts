import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

type Payload =
  | { type: 'fc_update'; fc_id: string; message?: string }
  | { type: 'fc_delete'; fc_id: string; message?: string }
  | { type: 'admin_update'; fc_id: string; message?: string }
  | { type: 'chat_targets'; resident_id?: string | null }
  | {
      type: 'inbox_list';
      role: 'admin' | 'fc';
      resident_id?: string | null;
      limit?: number;
    }
  | {
      type: 'inbox_unread_count';
      role: 'admin' | 'fc';
      resident_id?: string | null;
      since?: string | null;
    }
  | {
      type: 'inbox_delete';
      role: 'admin' | 'fc';
      resident_id?: string | null;
      notification_ids?: string[];
      notice_ids?: string[];
    }
  | { type: 'latest_notice' }
  | {
      type: 'notify';
      target_role: 'admin' | 'fc';
      target_id: string | null;
      title: string;
      body: string;
      category?: string;
      url?: string;
      fc_id?: string | null;
      sender_id?: string;
      sender_name?: string;
    }
  | {
      type: 'message';
      target_role: 'admin' | 'fc';
      target_id: string | null;
      message: string;
      sender_id: string;
      sender_name?: string;
      title?: string;
      body?: string;
      category?: string;
      url?: string;
      fc_id?: string | null;
    };

type TokenRow = { expo_push_token: string; resident_id: string | null; display_name: string | null };
type FcRow = {
  id: string;
  name: string | null;
  resident_id_masked: string | null;
  phone: string | null;
  affiliation: string | null;
};
type AdminAccountRow = { name?: string | null; phone: string | null; staff_type?: string | null };
type ManagerAccountRow = { phone: string | null };
type AffiliationManagerMappingRow = { manager_phone: string | null };
type NoticeFile = { name?: string; url?: string; type?: string };
type NotificationInsert = {
  title: string;
  body: string;
  category: string;
  recipient_role: 'admin' | 'fc' | 'manager';
  resident_id: string | null;
  fc_id?: string | null;
  target_url?: string | null;
};
type NoticeRow = {
  id: string;
  title: string;
  body: string;
  category: string | null;
  created_at: string;
  images?: string[] | null;
  files?: NoticeFile[] | null;
};
type BoardNoticeCategoryRow = {
  id: string;
  name: string | null;
};
type BoardNoticePostRow = {
  id: string;
  title: string;
  content: string;
  created_at: string;
};
type BoardAttachmentRow = {
  id: string;
  post_id: string;
  file_type: 'image' | 'file';
  file_name: string;
  file_size: number;
  mime_type: string | null;
  storage_path: string;
  sort_order: number;
  created_at: string;
};

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const BOARD_NOTICE_CATEGORY_SLUG = 'notice';
const BOARD_NOTICE_ID_PREFIX = 'board_notice:';
const BOARD_ATTACHMENT_SIGN_EXPIRES_SECONDS = 60 * 60 * 6;
const AFFILIATION_OPTIONS = [
  '1본부 서선미',
  '2본부 박성훈',
  '3본부 김태희',
  '4본부 현경숙',
  '5본부 최철준',
  '6본부 김정수(박선희)',
  '7본부 김동훈',
  '8본부 정승철',
  '9본부 이현욱(김주용)',
] as const;
const LEGACY_AFFILIATION_TO_NEW: Record<string, string> = {
  '1본부 [본부장: 서선미]': '1본부 서선미',
  '2본부 [본부장: 박성훈]': '2본부 박성훈',
  '3본부 [본부장: 김태희]': '3본부 김태희',
  '4본부 [본부장: 현경숙]': '4본부 현경숙',
  '5본부 [본부장: 최철준]': '5본부 최철준',
  '6본부 [본부장: 김정수]': '6본부 김정수(박선희)',
  '6본부 [본부장: 박선희]': '6본부 김정수(박선희)',
  '7본부 [본부장: 김동훈]': '7본부 김동훈',
  '8본부 [본부장: 정승철]': '8본부 정승철',
  '9본부 [본부장: 이현욱]': '9본부 이현욱(김주용)',
  '9본부 [본부장: 김주용]': '9본부 이현욱(김주용)',
  '1팀(서울1) : 서선미 본부장님': '1본부 서선미',
  '2팀(서울2) : 박성훈 본부장님': '2본부 박성훈',
  '3팀(부산1) : 김태희 본부장님': '3본부 김태희',
  '4팀(대전1) : 현경숙 본부장님': '4본부 현경숙',
  '5팀(대전2) : 최철준 본부장님': '5본부 최철준',
  '6팀(전주1) : 김정수 본부장님': '6본부 김정수(박선희)',
  '6팀(전주1) : 박선희 본부장님': '6본부 김정수(박선희)',
  '7팀(청주1/직할) : 김동훈 본부장님': '7본부 김동훈',
  '8팀(서울3) : 정승철 본부장님': '8본부 정승철',
  '9팀(서울4) : 이현옥 본부장님': '9본부 이현욱(김주용)',
  '9팀(서울4) : 이현욱 본부장님': '9본부 이현욱(김주용)',
};

const sanitize = (v?: string | null) => (v ?? '').replace(/[^0-9]/g, '');
const normalizeWhitespace = (value?: string | null) => (value ?? '').replace(/\s+/g, ' ').trim();
const normalizeAffiliationLabel = (value?: string | null): string => {
  const trimmed = normalizeWhitespace(value);
  if (!trimmed) return '';
  if (AFFILIATION_OPTIONS.includes(trimmed as (typeof AFFILIATION_OPTIONS)[number])) return trimmed;

  const mapped = LEGACY_AFFILIATION_TO_NEW[trimmed];
  if (mapped) return mapped;

  const prefix = trimmed.match(/^([1-9])\s*(본부|팀)/);
  if (prefix?.[1]) {
    const index = Number(prefix[1]) - 1;
    return AFFILIATION_OPTIONS[index] ?? trimmed;
  }

  return trimmed;
};

function getEnv(name: string): string | undefined {
  const g: any = globalThis as any;
  if (g?.Deno?.env?.get) return g.Deno.env.get(name);
  if (g?.process?.env) return g.process.env[name];
  return undefined;
}

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

function getAdminPushEndpoint(rawUrl: string): string | null {
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);
    return `${parsed.origin}/api/admin/push`;
  } catch {
    try {
      const parsed = new URL(`https://${trimmed}`);
      return `${parsed.origin}/api/admin/push`;
    } catch {
      return null;
    }
  }
}

type AdminWebPushResult = {
  ok: boolean;
  status?: number;
  sent?: number;
  failed?: number;
  reason?: string;
};

type NotificationSource = 'request_board' | 'fc_onboarding';
const REQUEST_BOARD_CATEGORY_PREFIX = 'request_board_';

function resolveNotificationSource(category?: string | null): NotificationSource {
  const normalized = (category ?? '').trim().toLowerCase();
  if (normalized.startsWith(REQUEST_BOARD_CATEGORY_PREFIX)) {
    return 'request_board';
  }
  return 'fc_onboarding';
}

function buildPushTitleWithSource(title: string, source: NotificationSource): string {
  if (source !== 'request_board') return title;

  const trimmed = title.trim();
  if (trimmed.startsWith('[설계요청]')) return trimmed;
  return `[설계요청] ${trimmed}`;
}

/**
 * Send web push notification to all admin browser subscribers.
 * Calls the Next.js /api/admin/push endpoint.
 * Fire-and-forget: errors are logged but do not block the response.
 */
async function notifyAdminWebPush(title: string, body: string, url: string) {
  const adminWebUrl = getEnv('ADMIN_WEB_URL');
  const pushSecret = getEnv('ADMIN_PUSH_SECRET');

  if (!adminWebUrl) {
    console.warn('[fc-notify] admin web push disabled: missing ADMIN_WEB_URL');
    return { ok: false, reason: 'missing-admin-web-url' } as AdminWebPushResult;
  }

  const endpoint = getAdminPushEndpoint(adminWebUrl);
  if (!endpoint) {
    console.warn('[fc-notify] admin web push disabled: invalid ADMIN_WEB_URL');
    return { ok: false, reason: 'invalid-admin-web-url' } as AdminWebPushResult;
  }

  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${serviceKey}`,
    'apikey': serviceKey,
  };
  if (pushSecret) {
    headers['X-Admin-Push-Secret'] = pushSecret;
  }

  try {
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({ title, body, url }),
    });

    const text = await resp.text().catch(() => '');
    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = text ? (JSON.parse(text) as Record<string, unknown>) : null;
    } catch {
      parsed = null;
    }

    if (!resp.ok) {
      console.warn('[fc-notify] admin web push callback failed', {
        status: resp.status,
        statusText: resp.statusText,
        body: text.slice(0, 300),
      });
      return {
        ok: false,
        status: resp.status,
        reason: `http-${resp.status}`,
      } as AdminWebPushResult;
    }

    const sent = typeof parsed?.sent === 'number' ? parsed.sent : undefined;
    const failed = typeof parsed?.failed === 'number' ? parsed.failed : undefined;
    return { ok: true, status: resp.status, sent, failed } as AdminWebPushResult;
  } catch (e) {
    console.warn('[fc-notify] admin web push callback failed', e);
    return { ok: false, reason: 'callback-network-error' } as AdminWebPushResult;
  }
}

async function fetchNoticesWithOptionalAttachments(limit = 20): Promise<NoticeRow[]> {
  const withAttachments = await supabase
    .from('notices')
    .select('id,title,body,category,created_at,images,files')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (!withAttachments.error) {
    return (withAttachments.data ?? []) as NoticeRow[];
  }

  // Backward compatibility: some environments may not have images/files columns yet.
  if (withAttachments.error.code === '42703') {
    const basic = await supabase
      .from('notices')
      .select('id,title,body,category,created_at')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (basic.error) throw basic.error;
    return ((basic.data ?? []) as NoticeRow[]).map((row) => ({
      ...row,
      images: null,
      files: null,
    }));
  }

  throw withAttachments.error;
}

function isMissingTableError(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === '42P01';
}

async function fetchBoardNoticeCategory(): Promise<BoardNoticeCategoryRow | null> {
  const { data, error } = await supabase
    .from('board_categories')
    .select('id,name')
    .eq('slug', BOARD_NOTICE_CATEGORY_SLUG)
    .maybeSingle();

  if (error) {
    if (isMissingTableError(error)) return null;
    throw error;
  }
  if (!data?.id) return null;

  return data as BoardNoticeCategoryRow;
}

async function createBoardAttachmentSignedUrl(storagePath: string): Promise<string | null> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { data, error } = await supabase.storage
      .from('board-attachments')
      .createSignedUrl(storagePath, BOARD_ATTACHMENT_SIGN_EXPIRES_SECONDS);
    if (!error && data?.signedUrl) {
      return data.signedUrl;
    }
  }
  return null;
}

async function fetchBoardNoticesWithAttachments(limit = 20): Promise<NoticeRow[]> {
  const category = await fetchBoardNoticeCategory();
  if (!category?.id) return [];

  const { data: posts, error: postError } = await supabase
    .from('board_posts')
    .select('id,title,content,created_at')
    .eq('category_id', category.id)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (postError) {
    if (isMissingTableError(postError)) return [];
    throw postError;
  }

  const postRows = (posts ?? []) as BoardNoticePostRow[];
  if (postRows.length === 0) return [];

  const postIds = postRows.map((row) => row.id);
  const { data: attachments, error: attachmentError } = await supabase
    .from('board_attachments')
    .select('id,post_id,file_type,file_name,file_size,mime_type,storage_path,sort_order,created_at')
    .in('post_id', postIds)
    .order('post_id', { ascending: true })
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });

  if (attachmentError) {
    if (isMissingTableError(attachmentError)) {
      return postRows.map((row) => ({
        id: `${BOARD_NOTICE_ID_PREFIX}${row.id}`,
        title: row.title,
        body: row.content,
        category: category.name ?? '공지',
        created_at: row.created_at,
        images: null,
        files: null,
      }));
    }
    throw attachmentError;
  }

  const attachmentRows = (attachments ?? []) as BoardAttachmentRow[];
  const signedEntries = await Promise.all(
    attachmentRows.map(async (row) => [row.id, await createBoardAttachmentSignedUrl(row.storage_path)] as const),
  );
  const signedUrlMap = new Map<string, string>();
  signedEntries.forEach(([id, signedUrl]) => {
    if (signedUrl) {
      signedUrlMap.set(id, signedUrl);
    }
  });

  const imageMap = new Map<string, string[]>();
  const fileMap = new Map<string, NoticeFile[]>();

  attachmentRows.forEach((row) => {
    const signedUrl = signedUrlMap.get(row.id);
    if (!signedUrl) return;

    if (row.file_type === 'image') {
      const current = imageMap.get(row.post_id) ?? [];
      current.push(signedUrl);
      imageMap.set(row.post_id, current);
      return;
    }

    const currentFiles = fileMap.get(row.post_id) ?? [];
    currentFiles.push({
      name: row.file_name,
      url: signedUrl,
      type: row.mime_type ?? 'application/octet-stream',
    });
    fileMap.set(row.post_id, currentFiles);
  });

  return postRows.map((row) => ({
    id: `${BOARD_NOTICE_ID_PREFIX}${row.id}`,
    title: row.title,
    body: row.content,
    category: category.name ?? '공지',
    created_at: row.created_at,
    images: imageMap.get(row.id) ?? null,
    files: fileMap.get(row.id) ?? null,
  }));
}

async function fetchUnifiedNotices(limit = 20): Promise<NoticeRow[]> {
  const safeLimit = Math.max(1, Math.min(limit, 200));
  const [legacyNotices, boardNotices] = await Promise.all([
    fetchNoticesWithOptionalAttachments(safeLimit).catch((error) => {
      if (isMissingTableError(error)) return [] as NoticeRow[];
      throw error;
    }),
    fetchBoardNoticesWithAttachments(safeLimit).catch((error) => {
      if (isMissingTableError(error)) return [] as NoticeRow[];
      throw error;
    }),
  ]);

  const merged = [...legacyNotices, ...boardNotices];
  merged.sort((a, b) => {
    const aTime = new Date(a.created_at).getTime();
    const bTime = new Date(b.created_at).getTime();
    return bTime - aTime;
  });
  return merged.slice(0, safeLimit);
}

function getTargetUrl(role: 'admin' | 'fc', payload: Payload, message: string, fcId: string): string {
  const msg = message.toLowerCase();

  if (role === 'fc') {
    if (msg.includes('임시번호') || msg.includes('경력')) return '/consent';
    if (msg.includes('서류 요청')) return '/docs-upload';
    if (msg.includes('위촉 url') || msg.includes('위촉url') || msg.includes('위촉')) return '/appointment';
    return '/notifications';
  }

  if (msg.includes('수당동의')) return '/dashboard';
  if (msg.includes('업로드') || msg.includes('제출') || msg.includes('서류')) return `/docs-upload?userId=${fcId}`;
  return '/notifications';
}

function buildTitle(fcName: string | null, payload: Payload, message?: string) {
  const name = fcName ?? 'FC';
  const msg = (message ?? '').toLowerCase();

  if (payload.type === 'admin_update') {
    if (msg.includes('위촉')) return '위촉 URL 등록';
    if (msg.includes('temp')) return `${name}의 임시번호 안내`;
    if (msg.includes('docs') || msg.includes('서류')) return `${name} 서류 요청`;
    return `${name} 정보 업데이트`;
  }
  if (payload.type === 'fc_delete') {
    const parts = message?.split(' ') ?? [];
    const docName = parts.length > 1 ? parts[1].replace(/[:,]/g, '') : '파일';
    return `${name} ${docName} 삭제`;
  }
  if (payload.type === 'fc_update') {
    if (msg.includes('기본') || msg.includes('정보')) return `${name} 기본 정보 업데이트`;
    if (msg.includes('temp')) return `${name}의 임시번호 안내`;
    if (msg.includes('서류') || msg.includes('업로드') || msg.includes('upload')) {
      const parts = message?.split(' ') ?? [];
      const docName = parts.length > 1 ? parts[1].replace(/[:,]/g, '') : '서류';
      return `${name} ${docName} 제출`;
    }
  }
  return `${name} 업데이트`;
}

function dedupeTokens(tokens: TokenRow[]): TokenRow[] {
  const seen = new Set<string>();
  return tokens.filter((token) => {
    const key = token.expo_push_token?.trim();
    if (!key) return false;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function resolveFcUpdateAdminRecipientIds(fcAffiliation?: string | null): Promise<string[]> {
  const normalizedAffiliation = normalizeAffiliationLabel(fcAffiliation);
  const [adminsRes, mappingRes] = await Promise.all([
    supabase
      .from('admin_accounts')
      .select('phone')
      .eq('active', true),
    supabase
      .from('affiliation_manager_mappings')
      .select('manager_phone')
      .eq('active', true)
      .eq('affiliation', normalizedAffiliation),
  ]);

  if (adminsRes.error) throw adminsRes.error;
  if (mappingRes.error && mappingRes.error.code !== '42P01') throw mappingRes.error;

  const adminPhones = ((adminsRes.data ?? []) as AdminAccountRow[])
    .map((admin) => sanitize(admin.phone))
    .filter((phone) => phone.length > 0);

  const mappedManagerPhones = ((mappingRes.data ?? []) as AffiliationManagerMappingRow[])
    .map((row) => sanitize(row.manager_phone))
    .filter((phone) => phone.length > 0);

  let managerPhones: string[] = [];
  if (mappedManagerPhones.length > 0) {
    const { data: activeManagers, error: managerErr } = await supabase
      .from('manager_accounts')
      .select('phone')
      .eq('active', true)
      .in('phone', mappedManagerPhones);
    if (managerErr) throw managerErr;
    managerPhones = ((activeManagers ?? []) as ManagerAccountRow[])
      .map((manager) => sanitize(manager.phone))
      .filter((phone) => phone.length > 0);
  }

  return Array.from(new Set([...adminPhones, ...managerPhones]));
}

// Security: Restrict CORS to specific origins
const allowedOrigins = (getEnv('ALLOWED_ORIGINS') ?? '').split(',').map(o => o.trim()).filter(Boolean);
const corsHeaders = {
  'Access-Control-Allow-Origin': allowedOrigins.length > 0 ? allowedOrigins[0] : '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-client-info, apikey',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Credentials': 'true',
};

function ok(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

function err(message: string, status = 400) {
  return new Response(message, { status, headers: corsHeaders });
}

async function insertNotificationWithFallback(payload: NotificationInsert) {
  const withTarget = {
    ...payload,
    target_url: payload.target_url ?? null,
  };

  const firstTry = await supabase.from('notifications').insert(withTarget);
  if (!firstTry.error) return null;

  const missingTargetColumn =
    firstTry.error.code === '42703' || String(firstTry.error.message ?? '').includes('target_url');
  if (!missingTargetColumn) return firstTry.error;

  const { target_url: _ignored, ...fallbackPayload } = withTarget;
  const secondTry = await supabase.from('notifications').insert(fallbackPayload);
  return secondTry.error ?? null;
}

serve(async (req: Request) => {
  // Preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return err('Method not allowed', 405);
  }

  let body: Payload;
  try {
    body = await req.json();
    console.log('[fc-notify] payload', body);
  } catch {
    return err('Invalid JSON', 400);
  }

  if (body.type === 'chat_targets') {
    const residentId = sanitize(body.resident_id);
    if (!residentId) {
      return err('resident_id is required', 400);
    }

    const { data: fcProfile, error: fcProfileErr } = await supabase
      .from('fc_profiles')
      .select('id')
      .eq('phone', residentId)
      .eq('signup_completed', true)
      .maybeSingle();
    if (fcProfileErr) return err(fcProfileErr.message, 500);
    if (!fcProfile?.id) return err('FC profile not found', 403);

    const [
      { data: managers, error: managerErr },
      { data: developers, error: developerErr },
      { data: admins, error: adminErr },
    ] = await Promise.all([
      supabase
        .from('manager_accounts')
        .select('name,phone')
        .eq('active', true)
        .order('name'),
      supabase
        .from('admin_accounts')
        .select('name,phone,staff_type')
        .eq('active', true)
        .eq('staff_type', 'developer')
        .order('name'),
      supabase
        .from('admin_accounts')
        .select('name,phone,staff_type')
        .eq('active', true)
        .neq('staff_type', 'developer')
        .order('name'),
    ]);
    if (managerErr) return err(managerErr.message, 500);
    if (developerErr) return err(developerErr.message, 500);
    if (adminErr) return err(adminErr.message, 500);

    return ok({
      ok: true,
      managers: (managers ?? [])
        .map((manager) => ({
          name: typeof manager.name === 'string' ? manager.name : '',
          phone: sanitize(manager.phone),
        }))
        .filter((manager) => manager.phone.length > 0),
      developers: ((developers ?? []) as AdminAccountRow[])
        .map((developer) => ({
          name: typeof developer.name === 'string' ? developer.name : '',
          phone: sanitize(developer.phone),
        }))
        .filter((developer) => developer.phone.length > 0),
      admins: ((admins ?? []) as AdminAccountRow[])
        .map((admin) => ({
          name: typeof admin.name === 'string' ? admin.name : '',
          phone: sanitize(admin.phone),
          staff_type: typeof admin.staff_type === 'string' ? admin.staff_type : null,
        }))
        .filter((admin) => admin.phone.length > 0),
    });
  }

  // 알림센터 목록 조회 (RLS 우회)
  if (body.type === 'inbox_list') {
    const role = body.role;
    const residentId = sanitize(body.resident_id);
    const limit = Math.max(1, Math.min(Number(body.limit ?? 80) || 80, 200));

    const buildNotifQuery = (selectColumns: string) => {
      let query = supabase
        .from('notifications')
        .select(selectColumns)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (role === 'fc') {
        if (residentId) {
          query = query.eq('recipient_role', 'fc').or(`resident_id.eq.${residentId},resident_id.is.null`);
        } else {
          query = query.eq('recipient_role', 'fc').is('resident_id', null);
        }
      } else {
        if (residentId) {
          query = query.eq('recipient_role', 'admin').or(`resident_id.eq.${residentId},resident_id.is.null`);
        } else {
          query = query.eq('recipient_role', 'admin').is('resident_id', null);
        }
      }

      return query;
    };

    let { data: notifications, error: notifErr } = await buildNotifQuery(
      'id,title,body,category,target_url,created_at,resident_id,recipient_role',
    );

    if (notifErr?.code === '42703') {
      const fallback = await buildNotifQuery('id,title,body,category,created_at,resident_id,recipient_role');
      notifErr = fallback.error;
      notifications = (fallback.data ?? []).map((row) => ({ ...row, target_url: null }));
    }

    if (notifErr) return err(notifErr.message, 500);

    let notices: NoticeRow[] = [];
    try {
      notices = await fetchUnifiedNotices(limit);
    } catch (noticeErr: unknown) {
      const message = noticeErr instanceof Error ? noticeErr.message : 'Failed to fetch notices';
      return err(message, 500);
    }

    return ok({
      ok: true,
      notifications: notifications ?? [],
      notices: notices ?? [],
    });
  }

  // 홈 벨 아이콘 unread 개수 조회 (RLS 우회)
  if (body.type === 'inbox_unread_count') {
    const role = body.role;
    const residentId = sanitize(body.resident_id);

    const sinceDate = body.since ? new Date(body.since) : new Date(0);
    const sinceIso = Number.isNaN(sinceDate.getTime()) ? new Date(0).toISOString() : sinceDate.toISOString();

    let countQuery = supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .gt('created_at', sinceIso);

    if (role === 'fc') {
      if (residentId) {
        countQuery = countQuery.eq('recipient_role', 'fc').or(`resident_id.eq.${residentId},resident_id.is.null`);
      } else {
        countQuery = countQuery.eq('recipient_role', 'fc').is('resident_id', null);
      }
    } else {
      if (residentId) {
        countQuery = countQuery.eq('recipient_role', 'admin').or(`resident_id.eq.${residentId},resident_id.is.null`);
      } else {
        countQuery = countQuery.eq('recipient_role', 'admin').is('resident_id', null);
      }
    }

    const { count, error: countErr } = await countQuery;
    if (countErr) return err(countErr.message, 500);

    return ok({ ok: true, count: count ?? 0 });
  }

  // 알림센터 선택 항목 삭제 (RLS 우회)
  if (body.type === 'inbox_delete') {
    const role = body.role;
    const residentId = sanitize(body.resident_id);
    const notificationIds = Array.isArray(body.notification_ids)
      ? body.notification_ids.filter((id) => typeof id === 'string' && id.trim().length > 0)
      : [];
    const noticeIds = Array.isArray(body.notice_ids)
      ? body.notice_ids.filter((id) => typeof id === 'string' && id.trim().length > 0)
      : [];
    const regularNoticeIds: string[] = [];
    const boardNoticePostIds: string[] = [];

    noticeIds.forEach((id) => {
      if (id.startsWith(BOARD_NOTICE_ID_PREFIX)) {
        const postId = id.slice(BOARD_NOTICE_ID_PREFIX.length).trim();
        if (postId) boardNoticePostIds.push(postId);
        return;
      }
      regularNoticeIds.push(id);
    });

    let deletedNotifications = 0;
    let deletedNotices = 0;

    if (notificationIds.length > 0) {
      let deleteQuery = supabase
        .from('notifications')
        .delete({ count: 'exact' })
        .in('id', notificationIds);

      if (role === 'fc') {
        if (residentId) {
          deleteQuery = deleteQuery.eq('recipient_role', 'fc').or(`resident_id.eq.${residentId},resident_id.is.null`);
        } else {
          deleteQuery = deleteQuery.eq('recipient_role', 'fc').is('resident_id', null);
        }
      } else {
        if (residentId) {
          deleteQuery = deleteQuery.eq('recipient_role', 'admin').or(`resident_id.eq.${residentId},resident_id.is.null`);
        } else {
          deleteQuery = deleteQuery.eq('recipient_role', 'admin').is('resident_id', null);
        }
      }

      const { count, error: notifDeleteErr } = await deleteQuery;
      if (notifDeleteErr) return err(notifDeleteErr.message, 500);
      deletedNotifications = count ?? 0;
    }

    // 공지 삭제는 admin 계정에서만 서버 삭제 허용
    if (regularNoticeIds.length > 0 && role === 'admin') {
      const { count, error: noticeDeleteErr } = await supabase
        .from('notices')
        .delete({ count: 'exact' })
        .in('id', regularNoticeIds);
      if (noticeDeleteErr) return err(noticeDeleteErr.message, 500);
      deletedNotices = count ?? 0;
    }

    // 게시판 공지(카테고리 slug=notice)도 공지 목록에서 삭제 요청 시 함께 삭제
    if (boardNoticePostIds.length > 0 && role === 'admin') {
      const category = await fetchBoardNoticeCategory();
      if (category?.id) {
        const { data: deletablePosts, error: postErr } = await supabase
          .from('board_posts')
          .select('id')
          .eq('category_id', category.id)
          .in('id', boardNoticePostIds);
        if (postErr) return err(postErr.message, 500);

        const deletableIds = (deletablePosts ?? []).map((row) => row.id as string);
        if (deletableIds.length > 0) {
          const { data: attachments, error: attachmentErr } = await supabase
            .from('board_attachments')
            .select('storage_path')
            .in('post_id', deletableIds);
          if (attachmentErr) return err(attachmentErr.message, 500);

          const storagePaths = (attachments ?? [])
            .map((row) => row.storage_path as string)
            .filter((path) => typeof path === 'string' && path.length > 0);
          if (storagePaths.length > 0) {
            const { error: storageErr } = await supabase.storage
              .from('board-attachments')
              .remove(storagePaths);
            if (storageErr) {
              console.warn('[fc-notify] board attachment cleanup failed', storageErr.message);
            }
          }

          const { count: boardDeleteCount, error: boardDeleteErr } = await supabase
            .from('board_posts')
            .delete({ count: 'exact' })
            .in('id', deletableIds);
          if (boardDeleteErr) return err(boardDeleteErr.message, 500);
          deletedNotices += boardDeleteCount ?? 0;
        }
      }
    }

    return ok({
      ok: true,
      deleted_notifications: deletedNotifications,
      deleted_notices: deletedNotices,
    });
  }

  // 홈 상단 최신 공지 조회 (RLS 우회)
  if (body.type === 'latest_notice') {
    try {
      const notices = await fetchBoardNoticesWithAttachments(1).catch((error) => {
        if (isMissingTableError(error)) return [] as NoticeRow[];
        throw error;
      });
      const notice = notices.length > 0
        ? {
          id: notices[0].id,
          title: notices[0].title,
          body: notices[0].body,
          category: notices[0].category,
          created_at: notices[0].created_at,
        }
        : null;
      return ok({ ok: true, notice });
    } catch (latestErr: unknown) {
      const message = latestErr instanceof Error ? latestErr.message : 'Failed to fetch latest notice';
      return err(message, 500);
    }
  }

  // 직접 알림 처리 (notify/message)
  if (body.type === 'notify' || body.type === 'message') {
    const target_role = body.target_role;
    const target_id = sanitize(body.target_id);

    const title =
      body.type === 'notify'
        ? body.title
        : body.title ?? '새 메시지';
    const message =
      body.type === 'notify'
        ? body.body
        : body.body ?? body.message ?? '새로운 메시지가 도착했습니다.';
    const category =
      body.type === 'notify'
        ? body.category ?? 'app_event'
        : body.category ?? 'message';
    const notificationSource = resolveNotificationSource(category);
    const pushTitle = buildPushTitleWithSource(title, notificationSource);

    let url = body.type === 'notify' ? body.url ?? '/notifications' : body.url ?? '/chat';
    if (body.type === 'message' && target_role === 'admin' && !body.url) {
      let senderName = body.sender_name?.trim() || '';

      if (!senderName && body.sender_id?.trim()) {
        const { data: senderProfile } = await supabase
          .from('fc_profiles')
          .select('name')
          .eq('phone', sanitize(body.sender_id))
          .maybeSingle();
        senderName = senderProfile?.name?.trim() || '';
      }

      const resolvedSenderName = senderName || body.sender_id || 'FC';
      url = `/chat?targetId=${encodeURIComponent(body.sender_id)}&targetName=${encodeURIComponent(resolvedSenderName)}`;
    }

    let tokens: TokenRow[] = [];

    if (target_id) {
      // target_id 지정 시 role과 무관하게 같은 번호의 모든 토큰(fc/admin/manager)을 대상으로 발송
      const { data, error } = await supabase
        .from('device_tokens')
        .select('expo_push_token,resident_id,display_name')
        .eq('resident_id', target_id);
      if (!error && data) tokens = data;
    } else {
      if (target_role === 'admin') {
        const { data, error } = await supabase
          .from('device_tokens')
          .select('expo_push_token,resident_id,display_name')
          .eq('role', 'admin');
        if (!error && data) tokens = data;
      } else {
        const { data, error } = await supabase
          .from('device_tokens')
          .select('expo_push_token,resident_id,display_name')
          .eq('role', 'fc');
        if (!error && data) tokens = data;
      }
    }
    tokens = dedupeTokens(tokens);

    const logError = await insertNotificationWithFallback({
      title,
      body: message,
      category,
      recipient_role: target_role,
      resident_id: target_id || null,
      fc_id: body.fc_id ?? null,
      target_url: url,
    });
    if (logError) {
      console.warn('notifications insert failed', logError.message);
    }

    let adminWebPush: AdminWebPushResult | null = null;
    // Send web push to admin browser subscribers
    if (target_role === 'admin') {
      adminWebPush = await notifyAdminWebPush(pushTitle, message, url);
    }

    if (!tokens.length) {
      return ok({ ok: true, sent: 0, logged: !logError, msg: 'No tokens found', web_push: adminWebPush });
    }

    const pushPayload = tokens.map((t) => ({
      to: t.expo_push_token,
      title: pushTitle,
      body: message,
      data: {
        url,
        type: category,
        source: notificationSource,
        resident_id: target_id || null,
      },
      sound: 'default',
      priority: 'high',
      channelId: 'alerts',
    }));

    const resp = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(pushPayload),
    });
    const result = await resp.json();

    return ok({ ok: true, sent: tokens.length, logged: !logError, result, web_push: adminWebPush });
  }

  // 기존 fc/admin 업데이트/삭제 로직
  if (!(body as any).fc_id) {
    return err('fc_id required', 400);
  }

  const fc_id = (body as any).fc_id;

  const { data: fc, error: fcError } = await supabase
    .from('fc_profiles')
    .select('id,name,resident_id_masked,phone,affiliation')
    .eq('id', fc_id)
    .maybeSingle();

  if (fcError || !fc) {
    return err('fc not found', 404);
  }
  const fcRow = fc as FcRow;

  const targetRole: 'admin' | 'fc' = body.type === 'admin_update' ? 'fc' : 'admin';
  const targetResidentId = targetRole === 'fc' ? sanitize(fcRow.phone) : null;
  const isFcAdminUpdateEvent = body.type === 'fc_update' || body.type === 'fc_delete';

  const title = buildTitle(fcRow.name, body, (body as any).message);
  const message = (body as any).message ?? title;
  const targetUrl = getTargetUrl(targetRole, body, message, fcRow.id);
  let tokens: TokenRow[] = [];
  let logError: { message: string } | null = null;

  if (isFcAdminUpdateEvent) {
    let recipientResidentIds: string[] = [];
    try {
      recipientResidentIds = await resolveFcUpdateAdminRecipientIds(fcRow.affiliation);
    } catch (recipientError: unknown) {
      const message = recipientError instanceof Error ? recipientError.message : 'failed to resolve admin recipients';
      return err(message, 500);
    }

    if (recipientResidentIds.length > 0) {
      const { data, error } = await supabase
        .from('device_tokens')
        .select('expo_push_token,resident_id,display_name')
        .eq('role', 'admin')
        .in('resident_id', recipientResidentIds);
      if (error) {
        console.warn('[fc-notify] device token load failed', error.message);
      } else if (data) {
        tokens = data;
      }

      const notificationRows = recipientResidentIds.map((recipientId) => ({
        title,
        body: message,
        category: (body as any).type,
        fc_id: fcRow.id,
        resident_id: recipientId,
        recipient_role: 'admin' as const,
        target_url: targetUrl,
      }));

      const firstTry = await supabase.from('notifications').insert(notificationRows);
      if (firstTry.error) {
        const missingTargetColumn =
          firstTry.error.code === '42703'
          || String(firstTry.error.message ?? '').includes('target_url');
        if (missingTargetColumn) {
          const fallbackRows = notificationRows.map(({ target_url: _ignored, ...row }) => row);
          const fallback = await supabase.from('notifications').insert(fallbackRows);
          if (fallback.error) {
            logError = fallback.error;
          }
        } else {
          logError = firstTry.error;
        }
      }
    } else {
      console.warn('[fc-notify] no admin recipients resolved for fc_update/fc_delete', {
        fc_id,
        affiliation: fcRow.affiliation,
      });
    }
  } else {
    if (!targetResidentId) return err('FC phone number not found', 400);
    const { data, error } = await supabase
      .from('device_tokens')
      .select('expo_push_token,resident_id,display_name')
      .eq('resident_id', targetResidentId);
    if (!error && data) tokens = data;

    logError = await insertNotificationWithFallback({
      title,
      body: message,
      category: (body as any).type,
      fc_id: fcRow.id,
      resident_id: targetResidentId,
      recipient_role: targetRole,
      target_url: targetUrl,
    });
  }

  tokens = dedupeTokens(tokens);
  if (logError) console.warn('notifications insert failed', logError.message);

  let adminWebPush: AdminWebPushResult | null = null;
  // Send web push to admin browser subscribers for fc_update / fc_delete
  if (targetRole === 'admin') {
    adminWebPush = await notifyAdminWebPush(title, message, targetUrl);
  }

  if (!tokens.length) {
    return ok({ ok: true, sent: 0, logged: !logError, web_push: adminWebPush });
  }

  const payload = tokens.map((t) => ({
    to: t.expo_push_token,
    title,
    body: message,
    data: {
      fc_id: fcRow.id,
      resident_id: fcRow.phone ?? fcRow.resident_id_masked,
      name: fcRow.name,
      url: targetUrl,
    },
    sound: 'default',
    priority: 'high',
    channelId: 'alerts',
  }));

  const resp = await fetch(EXPO_PUSH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const result = await resp.json();

  return ok({ ok: true, sent: tokens.length, logged: !logError, result, web_push: adminWebPush });
});
